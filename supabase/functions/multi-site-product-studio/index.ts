import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:cors});
const sites={transport:"https://transport.dubaipremiertourism.com",safari:"https://safari.dubaipremiertourism.com"} as const;
const txt=(v:unknown,n=12000)=>String(v??"").trim().slice(0,n);
const arr=(v:unknown)=>Array.isArray(v)?v.map(x=>txt(x,180)).filter(Boolean).slice(0,12):[];
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
  const body=await req.json();
  if(body.action!=="generate_draft")return reply(400,{success:false,error:"Unsupported action."});
  const siteKey=txt(body.site_key,20) as keyof typeof sites;
  if(!(siteKey in sites))return reply(400,{success:false,error:"Choose a supported website."});
  const site=sites[siteKey];
  if(txt(body.target_site,200)!==site)return reply(400,{success:false,error:"Target website does not match the selected studio."});
  const title=txt(body.product_title,180),type=txt(body.product_type,100),focus=txt(body.focus_keyphrase,180),facts=txt(body.verified_facts,12000);
  const related=arr(body.related_keyphrases),audience=txt(body.audience,500),notes=txt(body.notes,3000);
  if(!title||!type||!focus||facts.length<30)return reply(400,{success:false,error:"Product name, type, primary keyphrase and at least 30 characters of verified facts are required."});
  const key=Deno.env.get("GEMINI_API_KEY");
  if(!key)return reply(503,{success:false,error:"Draft generation is not connected: GEMINI_API_KEY is missing from Supabase Edge Function secrets. No product was created."});
  const model=Deno.env.get("MULTI_SITE_PRODUCT_MODEL")||"gemini-2.5-flash";
  const prompt="Create an original product draft only for "+site+". Topic: "+(siteKey==="transport"?"transportation services":"desert safari experiences")+". Do NOT copy, quote, imitate, or fetch text from https://www.dubaipremiertourism.com or any other company page. Write from scratch. Do not claim a plagiarism check was performed. Never invent prices, vehicle models, capacity, timings, inclusions, exclusions, safety promises, permits, cancellation terms or availability. Use only VERIFIED FACTS; omit missing facts and report them in factual_gaps. No keyword stuffing or ranking guarantees.\nProduct title: "+title+"\nProduct type: "+type+"\nPrimary keyphrase: "+focus+"\nRelated phrases: "+JSON.stringify(related)+"\nAudience: "+audience+"\nInstructions: "+notes+"\nVERIFIED FACTS: "+facts+"\nReturn JSON with seo_title, meta_description, focus_synonyms (array), related_keyphrase_synonyms (array of {keyphrase,synonyms}), short_description (70-110 words), content_html, faq_json (array of question/answer), factual_gaps (array), content_outline (array). SEO title should be 45-60 characters when natural; meta description 120-155 characters. HTML must include relevant H2/H3 sections including Highlights, Inclusions, Exclusions, Timings & Duration, Booking/Cancellation policy, Why Choose Premier Express Tourism and supported FAQs. Include the primary phrase naturally. For transport focus service fit, pickup and booking clarity. For safari use only supplied package/activity details.";
  const gen=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent?key="+key,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json",temperature:0.4,maxOutputTokens:6500}})});
  const gj=await gen.json().catch(()=>({}));
  if(!gen.ok)return reply(502,{success:false,error:"AI draft generation failed. No product was saved.",provider_status:gen.status,detail:txt(gj?.error?.message,500)});
  const raw=gj?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||"").join("")||"";
  let d:any;try{d=JSON.parse(raw)}catch{return reply(502,{success:false,error:"AI returned invalid draft structure. Nothing was saved."})}
  if(!d.seo_title||!d.meta_description||!d.short_description||!d.content_html)return reply(502,{success:false,error:"AI draft missed required fields. Nothing was saved."});
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.from("multi_site_product_drafts").insert({created_by:userData.user.id,site_key:siteKey,target_site:site,product_title:title,product_type:type,focus_keyphrase:focus,related_keyphrases:related,verified_facts:facts,audience,notes,seo_title:txt(d.seo_title,180),meta_description:txt(d.meta_description,300),focus_synonyms:arr(d.focus_synonyms),related_keyphrase_synonyms:Array.isArray(d.related_keyphrase_synonyms)?d.related_keyphrase_synonyms:[],short_description:txt(d.short_description,12000),content_html:txt(d.content_html,50000),faq_json:Array.isArray(d.faq_json)?d.faq_json:[],status:Array.isArray(d.factual_gaps)&&d.factual_gaps.length?"NEEDS_FACTS":"DRAFT_REVIEW",duplicate_check_status:"NOT_RUN",publication_authorized:false,generation_model:model,review_notes:JSON.stringify({factual_gaps:d.factual_gaps||[],content_outline:d.content_outline||[],plagiarism_check:"NOT_RUN",publishing:"DISABLED_UNTIL_SITE_CREDENTIALS_AND_GATES_ARE_CONFIGURED"})}).select("id,site_key,target_site,product_title,product_type,focus_keyphrase,seo_title,meta_description,short_description,content_html,faq_json,status,created_at,publication_authorized").single();
  if(error)return reply(500,{success:false,error:"Draft generation succeeded but database save failed. No website write was attempted.",detail:error.message});
  return reply(200,{success:true,draft:data,factual_gaps:d.factual_gaps||[],content_outline:d.content_outline||[],duplicate_check_status:"NOT_RUN",live_published:false,wordpress_write_performed:false,publication_authorized:false});
 }catch(e){return reply(500,{success:false,error:e instanceof Error?e.message:"Unexpected product studio error.",wordpress_write_performed:false})}
});
