import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:cors});
const sites={transport:"https://transport.dubaipremiertourism.com",safari:"https://safari.dubaipremiertourism.com"} as const;
const txt=(v:unknown,n=12000)=>String(v??"").trim().slice(0,n);
const arr=(v:unknown)=>Array.isArray(v)?v.map(x=>txt(x,180)).filter(Boolean).slice(0,20):[];
const strip=(s:string,max=6500)=>s.replace(/<script[\\s\\S]*?<\\/script>/gi," ").replace(/<style[\\s\\S]*?<\\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\\s+/g," ").trim().slice(0,max);
const relevant=(siteKey:string,p:any)=>{
 const name=String(p.name||"").toLowerCase(),cats=(p.categories||[]).map((c:any)=>String(c.name||"").toLowerCase()+" "+String(c.slug||"").toLowerCase()).join(" ");
 if(siteKey==="safari") return /desert safari|morning safari|evening safari|overnight safari|desert adventure|dune buggy|quad bike|quad biking|camel trek|red dunes/.test(name+" "+cats) && !/al ain zoo|safari suv|safari truck|zoo/.test(name);
 return /chauffeur|airport transfer|private transfer|luxury transportation|transportation dubai|car rental|vehicle rental|bus rental|van rental|fleet|limousine|executive travel|intercity transfer|cross.border transfer|sprinter|coaster|hiace|land cruiser|g.?63|s.?500|es 350|yukon|escalade|v.class|carnival/.test(name+" "+cats) && !/desert safari|dune buggy/.test(name);
};
async function syncCatalog(db:any,siteKey:string){
 const api="https://dubaipremiertourism.com/wp-json/wc/store/v1";
 const catRes=await fetch(api+"/products/categories?per_page=100",{headers:{"Accept":"application/json"}});
 if(!catRes.ok) throw new Error("Main website product categories could not be read (HTTP "+catRes.status+").");
 const cats=await catRes.json();
 const catPattern=siteKey==="transport"?/luxury fleet|private transfers|transport|chauffeur|luxury cars|sedan|van|bus|vip suv|fleet/i:/desert safari|desert adventure|dune buggy|quad bike/i;
 const selectedCats=(Array.isArray(cats)?cats:[]).filter((c:any)=>catPattern.test(String(c.name||"")+" "+String(c.slug||""))).slice(0,8);
 const products=new Map<number,any>();
 const readPage=async(url:string)=>{const r=await fetch(url,{headers:{"Accept":"application/json"}});if(!r.ok)return;const data=await r.json();if(Array.isArray(data))for(const p of data)if(p&&p.id&&relevant(siteKey,p))products.set(Number(p.id),p);};
 if(selectedCats.length){
  const ids=selectedCats.map((c:any)=>c.id).filter(Boolean).join(",");
  await readPage(api+"/products?category="+encodeURIComponent(ids)+"&per_page=100&page=1");
 }
 const terms=siteKey==="transport"?["airport transfer","chauffeur service","bus rental Dubai","luxury fleet private transfers"]:["desert safari Dubai","morning desert safari","evening desert safari","dune buggy Dubai"];
 for(const term of terms.slice(0,4)) await readPage(api+"/products?search="+encodeURIComponent(term)+"&per_page=100&page=1");
 const now=new Date().toISOString();
 const productIds=[...products.values()].map((p:any)=>Number(p.id));
 const existingRows=productIds.length?(await db.from("multi_site_product_sources").select("source_product_id,linked_draft_id,generation_attempts,last_generation_error,last_generation_attempt_at,created_at").eq("site_key",siteKey).in("source_product_id",productIds)).data||[]:[];
 const existing=new Map<number,any>(existingRows.map((x:any)=>[Number(x.source_product_id),x]));
 const rows=[...products.values()].map((p:any)=>{
  const prior=existing.get(Number(p.id));
  return {
   site_key:siteKey,source_product_id:Number(p.id),source_title:txt(p.name,250),source_slug:txt(p.slug,250),source_url:txt(p.permalink,1000),
   source_description:strip(String(p.description||"")),source_short_description:strip(String(p.short_description||"")),
   source_price_reference:p.prices?.price?String(p.prices.price)+(p.prices.currency_code?" "+p.prices.currency_code:""):"",
   source_categories:Array.isArray(p.categories)?p.categories.map((c:any)=>({id:c.id,name:c.name,slug:c.slug})):[],
   source_image_url:txt(p.images?.[0]?.src,1000),source_data:{type:p.type||"",prices:p.prices||{},attributes:p.attributes||[],categories:p.categories||[]},
   linked_draft_id:prior?.linked_draft_id||null,generation_attempts:prior?.generation_attempts||0,last_generation_error:prior?.last_generation_error||"",last_generation_attempt_at:prior?.last_generation_attempt_at||null,created_at:prior?.created_at||now,
   last_synced_at:now,updated_at:now
  };
 });
 for(let i=0;i<rows.length;i+=50){
  const {error}=await db.from("multi_site_product_sources").upsert(rows.slice(i,i+50),{onConflict:"site_key,source_product_id",ignoreDuplicates:false});
  if(error)throw new Error("Catalog save failed: "+error.message);
 }
 return {site_key:siteKey,matched_products:rows.length,categories_checked:selectedCats.map((c:any)=>c.name),synced_at:now};
}
function evaluateDraft(d:any,siteKey:string){
 const html=String(d.content_html||""),body=strip(html,50000),short=strip(String(d.short_description||""),12000);
 const words=body.split(/\s+/).filter(Boolean).length,shortWords=short.split(/\s+/).filter(Boolean).length;
 const heads=[...html.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m:any)=>strip(m[2]).toLowerCase());
 const uniqueHeads=new Set(heads);
 const faqCount=Array.isArray(d.faq_json)?d.faq_json.length:0;
 const focus=txt(d.focus_keyphrase||"",180).toLowerCase();
 const inBody=!!focus&&body.toLowerCase().includes(focus);
 const inHeading=!!focus&&heads.some(h=>h.includes(focus));
 const sectionPatterns=siteKey==="transport"
  ?[/service overview|vehicle overview|transport overview/i,/passenger.*luggage|luggage.*passenger/i,/airport.*pickup|pickup.*airport/i,/corporate|executive transportation/i,/hourly.*chauffeur|full.day.*booking/i,/private journey|hotel transfer|event transfer/i,/booking options|recurring corporate/i,/highlights/i,/inclusions/i,/exclusions|additional charges/i,/timings|duration|availability/i,/why choose premier express/i,/quote request|how to book|how to request/i,/frequently asked|\bfaqs?\b/i]
  :[/safari overview/i,/itinerary|what to expect/i,/highlights/i,/activities|camp experience/i,/food|refreshments|dining/i,/transfer|pickup information/i,/inclusions/i,/exclusions|optional add.ons/i,/timings|duration/i,/safety|eligibility|visitor information/i,/booking.*cancellation|refund policy/i,/why choose premier express/i,/how to book|booking steps/i,/frequently asked|\bfaqs?\b/i];
 const sectionHits=sectionPatterns.filter(re=>re.test(heads.join(" | "))).length;
 const contentChecks=[
  {name:"short_description_70_110_words",pass:shortWords>=70&&shortWords<=110},
  {name:"product_body_at_least_1000_words",pass:words>=1000},
  {name:"service_specific_sections",pass:sectionHits>=sectionPatterns.length-1},
  {name:"faq_minimum",pass:faqCount>=(siteKey==="safari"?7:6)},
  {name:"unique_semantic_headings",pass:heads.length>=8&&uniqueHeads.size===heads.length},
  {name:"focus_phrase_in_body_and_heading",pass:inBody&&inHeading}
 ];
 const contentWeights=[10,12,42,10,10,16];
 let contentScore=contentChecks.reduce((sum,x,i)=>sum+(x.pass?contentWeights[i]:0),0);
 const title=txt(d.seo_title||"",180),meta=txt(d.meta_description||"",300);
 const synonyms=arr(d.focus_synonyms),related=arr(d.related_keyphrases),relatedSyn=Array.isArray(d.related_keyphrase_synonyms)?d.related_keyphrase_synonyms:[];
 const seoChecks=[
  {name:"seo_title_45_60_chars",pass:title.length>=45&&title.length<=60},
  {name:"meta_description_120_155_chars",pass:meta.length>=120&&meta.length<=155},
  {name:"focus_phrase_in_title",pass:!!focus&&title.toLowerCase().includes(focus)},
  {name:"focus_phrase_in_meta",pass:!!focus&&meta.toLowerCase().includes(focus)},
  {name:"focus_phrase_in_short_description",pass:!!focus&&short.toLowerCase().includes(focus)},
  {name:"focus_phrase_in_heading",pass:inHeading},
  {name:"four_focus_synonyms",pass:synonyms.length>=4},
  {name:"four_related_keyphrases",pass:related.length>=4},
  {name:"four_related_phrases_with_four_synonyms_each",pass:relatedSyn.length>=4&&relatedSyn.slice(0,4).every((x:any)=>Array.isArray(x.synonyms)&&x.synonyms.length>=4)}
 ];
 const seoWeights=[10,10,15,15,10,10,10,10,10];
 const seoScore=seoChecks.reduce((sum,x,i)=>sum+(x.pass?seoWeights[i]:0),0);
 return {content_score:contentScore,seo_score:seoScore,word_count:words,short_description_word_count:shortWords,faq_count:faqCount,section_hits:sectionHits,section_total:sectionPatterns.length,content_checks:contentChecks,seo_checks:seoChecks,content_failures:contentChecks.filter(x=>!x.pass).map(x=>x.name),seo_failures:seoChecks.filter(x=>!x.pass).map(x=>x.name)};
}
async function makeDraft(db:any,key:string,siteKey:string,site:string,p:any,model:string,apiKey:string,userId:string){
 const facts=JSON.stringify({
  source_title:p.source_title,source_url:p.source_url,source_description:strip(p.source_description||""),source_short_description:strip(p.source_short_description||""),
  source_price_reference_for_internal_reference_only:p.source_price_reference,source_categories:p.source_categories,source_attributes:p.source_data?.attributes||[]
 });
 const isTransport=siteKey==="transport";
 const blueprint=isTransport
 ? "Create a premium WooCommerce chauffeur/transport product page. Required HTML structure: short description 70-110 words; H2 Vehicle/Service Overview; H2 Passenger and Luggage Information (only state numbers if sourced, otherwise explain confirmation); H2 Airport Transfers and Pickups; H2 Corporate and Executive Transportation; H2 Hourly Chauffeur Hire and Full-Day Bookings; H2 Private Journeys, Hotel Transfers and Events; H2 Booking Options and Recurring Corporate Enquiries; H2 Highlights; H2 Inclusions; H2 Exclusions and Possible Additional Charges; H2 Timings, Availability and Booking Information; H2 Why Choose Premier Express Tourism (5-6 distinct useful bullets); H2 How to Request a Quote (clear step-by-step, collect date/time, pickup/drop-off, passengers, luggage, flight/meeting details as relevant); H2 FAQs with at least 6 specific Q&As; H2 Related Vehicles and Fleet Categories with internal-link placeholders only when real URLs are supplied. Add a WhatsApp quote CTA using https://wa.me/971562026553 with a short prefilled message encoded safely or a plain link. Cover service fit, vehicle selection, pickup, quote process and corporate enquiries. Never promise availability or exact capacity unless verified."
 : "Create a premium Dubai/UAE desert safari WooCommerce product page, not generic transport copy. Required HTML structure: short description 70-110 words; H2 Safari Overview; H2 Desert Location and Experience Style (only if supported); H2 What to Expect / Step-by-Step Itinerary; H2 Safari Highlights; H2 Activities and Camp Experience; H2 Food and Refreshments; H2 Transfers and Pickup Information; H2 Inclusions; H2 Exclusions and Optional Add-ons; H2 Timings and Duration; H2 Safety, Eligibility and Important Visitor Information (no medical/legal certainty; mark facts needing operator confirmation); H2 Booking, Cancellation and Refund Policy; H2 Why Choose Premier Express Tourism (5-6 meaningful bullets); H2 How to Book; H2 FAQs with at least 7 specific Q&As; H2 Related Desert Experiences with links only when real URLs are supplied. Differentiate morning/evening/private/VIP/overnight/quad-buggy products according to source details. Do not imply an add-on is included unless verified.";
 const prompt="You are Premier Express Tourism's permanent expert product editor. Generate one complete, high-quality, conversion-focused ORIGINAL product for "+site+". This request is part of an automated batch: do not ask the user for more instructions. Use the stored blueprint below every time. Never copy phrases or paragraphs from the source or competitors. The source product is the factual seed, not text to rewrite sentence-by-sentence. Do not create unsupported claims, prices, vehicle capacities, service inclusions, permits, safety guarantees, timings, refund terms, availability, review counts, or rankings. The old site's price is internal context only; do not present it as the new site's price. If facts are missing, write neutral wording and add a factual_gaps entry for the human reviewer. No ranking guarantees, keyword stuffing or fake testimonials. Include natural primary phrase in the opening, at least one H2, body and meta description. Use clear semantic H2/H3 hierarchy, human English, useful specifics, and no duplicate filler. Short description must be 70-110 words. "+blueprint+
"\nSOURCE PRODUCT DATA (treat as unverified where terms/operational details are unclear): "+facts+
"\nCompetitor/search research: use Google Search grounding to identify current search intent, useful subtopics, questions and content gaps for this exact product type in Dubai/UAE. Research is for ideas and fact-checking only; do not reproduce competitor wording, prices or unverified claims. Prioritize official/primary sources for factual claims. If no source is reliable, leave the detail out and flag it.\nReturn JSON with: seo_title, meta_description, focus_keyphrase, focus_synonyms (array), related_keyphrases (array), related_keyphrase_synonyms (array of {keyphrase,synonyms}), short_description, content_html, faq_json (array of {question,answer}), factual_gaps (array of strings), content_outline (array of strings), research_sources (array of {title,url,why_relevant}), research_notes (array of strings), product_differentiators (array of strings). SEO title ideally 45-60 characters and meta description 120-155 characters where natural. HTML only for content_html.";
 const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+apiKey,{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],tools:[{google_search:{}}],generationConfig:{responseMimeType:"application/json",temperature:0.35,maxOutputTokens:8500}})
 });
 const g=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error("AI research/generation failed for "+p.source_title+" (HTTP "+response.status+"): "+txt(g?.error?.message,220));
 let candidate=g?.candidates?.[0]||{};
 let raw=candidate?.content?.parts?.map((part:any)=>part.text||"").join("")||"";
 let d:any;try{d=JSON.parse(raw)}catch{throw new Error("AI returned an invalid structured draft for "+p.source_title);}
 if(!d.seo_title||!d.meta_description||!d.short_description||!d.content_html)throw new Error("AI omitted required SEO/content fields for "+p.source_title);
 let quality=evaluateDraft(d,siteKey);
 if(quality.content_score<90||quality.seo_score!==100){
  const repairPrompt="Improve this product draft to pass the supplied deterministic quality checks. Keep the same product and source facts. Do not invent any missing facts; preserve factual_gaps. Write original content and repair every failed content/SEO check. Content must score at least 90/100 and SEO exactly 100/100. Keep short description 70-110 words, required service-specific headings, sufficient FAQs, natural focus phrase placement, four focus synonyms, four related keyphrases, and at least four synonyms for each of the first four related phrases. SEO title 45-60 characters; meta description 120-155 characters. Return the complete same JSON fields, not commentary.\nSITE TYPE: "+siteKey+"\nFAILED CHECKS: "+JSON.stringify(quality)+"\nDRAFT JSON: "+JSON.stringify(d);
  const repairedResponse=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+apiKey,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:repairPrompt}]}],generationConfig:{responseMimeType:"application/json",temperature:0.2,maxOutputTokens:8500}})});
  const repairedJson=await repairedResponse.json().catch(()=>({}));
  if(repairedResponse.ok){
   const repairedRaw=repairedJson?.candidates?.[0]?.content?.parts?.map((part:any)=>part.text||"").join("")||"";
   try{const repaired=JSON.parse(repairedRaw);d={...d,...repaired,research_sources:repaired.research_sources||d.research_sources,research_notes:repaired.research_notes||d.research_notes,product_differentiators:repaired.product_differentiators||d.product_differentiators};quality=evaluateDraft(d,siteKey);candidate=repairedJson?.candidates?.[0]||candidate;}catch{/* Keep the first complete draft and its honest score. */}
  }
 }
 const gaps=Array.isArray(d.factual_gaps)?d.factual_gaps:[];
 const researchSources=Array.isArray(d.research_sources)?d.research_sources:[];
 const {data,error}=await db.from("multi_site_product_drafts").insert({
  created_by:userId,site_key:siteKey,target_site:site,source_product_id:p.source_product_id,source_product_url:p.source_url,product_title:p.source_title,product_type:siteKey==="transport"?"Transport / chauffeur product":"Desert safari experience",
  focus_keyphrase:txt(d.focus_keyphrase||p.source_title,180),related_keyphrases:arr(d.related_keyphrases),
  verified_facts:"Source product URL: "+p.source_url+"\nSource product details (reference only): "+facts,
  audience:"Inferred from product category; human reviewer to confirm.",notes:"AUTOMATED CATALOG DRAFT. Research-first, original writing. Source product ID: "+p.source_product_id+". Source URL: "+p.source_url,
  seo_title:txt(d.seo_title,180),meta_description:txt(d.meta_description,300),focus_synonyms:arr(d.focus_synonyms),
  related_keyphrase_synonyms:Array.isArray(d.related_keyphrase_synonyms)?d.related_keyphrase_synonyms:[],
  short_description:txt(d.short_description,12000),content_html:txt(d.content_html,50000),faq_json:Array.isArray(d.faq_json)?d.faq_json:[],
  status:gaps.length?"NEEDS_FACTS":"DRAFT_REVIEW",content_score:quality.content_score,seo_score:quality.seo_score,duplicate_check_status:"NOT_RUN",publication_authorized:false,generation_model:model,
  review_notes:JSON.stringify({source_product_id:p.source_product_id,source_product_url:p.source_url,factual_gaps:gaps,quality_scores:{content_score:quality.content_score,seo_score:quality.seo_score},quality_checklist:quality,content_outline:d.content_outline||[],research_notes:d.research_notes||[],research_sources:researchSources,product_differentiators:d.product_differentiators||[],grounding_queries:candidate.groundingMetadata?.webSearchQueries||[],grounding_chunks:candidate.groundingMetadata?.groundingChunks||[],duplicate_check:"NOT_RUN",plagiarism_check:"NOT_RUN",publishing:"DISABLED_UNTIL_SEPARATE_WORDPRESS_CONNECTION_AND_GATES_ARE_CONFIGURED"})
 }).select("id,product_title,status,seo_title,meta_description,content_score,seo_score,created_at").single();
 if(error)throw new Error("Draft save failed for "+p.source_title+": "+error.message);
 const {error:linkError}=await db.from("multi_site_product_sources").update({linked_draft_id:data.id,updated_at:new Date().toISOString()}).eq("id",p.id);
 if(linkError)throw new Error("Draft created but source link could not be updated for "+p.source_title+": "+linkError.message);
 return {draft:data,source_title:p.source_title,source_url:p.source_url};
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply(405,{success:false,error:"POST required"});
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return reply(503,{success:false,error:"Product studio backend configuration is incomplete."});
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return reply(401,{success:false,error:"Sign in to the Main Agent first."});
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:authError}=await userClient.auth.getUser();
  if(authError||!userData.user)return reply(401,{success:false,error:"Your session is invalid or expired. Sign in again."});
  const body=await req.json(),action=txt(body.action,40);
  const siteKey=txt(body.site_key,20) as keyof typeof sites;
  if(!(siteKey in sites))return reply(400,{success:false,error:"Choose a supported website."});
  const site=sites[siteKey];
  if(body.target_site&&txt(body.target_site,200)!==site)return reply(400,{success:false,error:"Target website does not match the selected studio."});
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  if(action==="sync_catalog"){
   const result=await syncCatalog(db,siteKey);
   const {count}=await db.from("multi_site_product_sources").select("id",{count:"exact",head:true}).eq("site_key",siteKey);
   const {count:pending}=await db.from("multi_site_product_sources").select("id",{count:"exact",head:true}).eq("site_key",siteKey).is("linked_draft_id",null);
   return reply(200,{success:true,catalog:result,total_catalog_products:count??result.matched_products,awaiting_draft_generation:pending??result.matched_products,source_website:"https://dubaipremiertourism.com",live_published:false});
  }
  if(action==="retry_failed"){
   const {data,error}=await db.from("multi_site_product_sources").update({generation_attempts:0,last_generation_error:"",updated_at:new Date().toISOString()}).eq("site_key",siteKey).is("linked_draft_id",null).gte("generation_attempts",3).select("id");
   if(error)return reply(500,{success:false,error:"Could not reset failed catalog items: "+error.message});
   return reply(200,{success:true,retry_items_reset:data?.length||0,live_published:false});
  }
  if(action==="generate_catalog_batch"){
   const key=Deno.env.get("GEMINI_API_KEY");
   if(!key)return reply(503,{success:false,error:"GEMINI_API_KEY is missing from Supabase Edge Function secrets. No product was created."});
   const model=Deno.env.get("MULTI_SITE_PRODUCT_MODEL")||"gemini-2.5-flash";
   const {data:rows,error}=await db.from("multi_site_product_sources").select("*").eq("site_key",siteKey).is("linked_draft_id",null).lt("generation_attempts",3).order("source_title",{ascending:true}).limit(3);
   if(error)return reply(500,{success:false,error:"Could not load source products: "+error.message});
   if(!rows?.length)return reply(200,{success:true,generated_count:0,failed_count:0,has_more:false,message:"All currently synced source products already have drafts.",live_published:false,wordpress_write_performed:false});
   const generated:any[]=[],failed:any[]=[];
   for(const p of rows){
    const {data:existingDraft}=await db.from("multi_site_product_drafts").select("id,product_title,status,seo_title,meta_description,created_at").eq("site_key",siteKey).eq("source_product_id",p.source_product_id).maybeSingle();
    if(existingDraft){await db.from("multi_site_product_sources").update({linked_draft_id:existingDraft.id,updated_at:new Date().toISOString()}).eq("id",p.id);generated.push({draft:existingDraft,source_title:p.source_title,source_url:p.source_url,already_existed:true});continue;}
    await db.from("multi_site_product_sources").update({generation_attempts:(p.generation_attempts||0)+1,last_generation_attempt_at:new Date().toISOString(),last_generation_error:"",updated_at:new Date().toISOString()}).eq("id",p.id);
    try{generated.push(await makeDraft(db,key,siteKey,site,p,model,key,userData.user.id));}
    catch(e){const message=e instanceof Error?e.message:"Unknown generation error";await db.from("multi_site_product_sources").update({last_generation_error:txt(message,1000),updated_at:new Date().toISOString()}).eq("id",p.id);failed.push({source_title:p.source_title,error:message});}
   }
   const {count:remaining}=await db.from("multi_site_product_sources").select("id",{count:"exact",head:true}).eq("site_key",siteKey).is("linked_draft_id",null);
   return reply(200,{success:true,generated_count:generated.length,failed_count:failed.length,generated,failed,remaining:remaining??0,has_more:(remaining??0)>0,live_published:false,wordpress_write_performed:false,publication_authorized:false});
  }
  return reply(400,{success:false,error:"Unsupported action. Use sync_catalog or generate_catalog_batch."});
 }catch(e){return reply(500,{success:false,error:e instanceof Error?e.message:"Unexpected product studio error.",wordpress_write_performed:false})}
});
