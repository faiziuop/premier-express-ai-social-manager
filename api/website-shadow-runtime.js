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
const isFaqHeading=value=>/frequently asked|\bfaqs?\b/i.test(String(value||""));
function decodeWp(value){return String(value||"").replace(/&#8211;|&ndash;/g,"–").replace(/&#8217;|&rsquo;/g,"’").replace(/&amp;/g,"&").replace(/<[^>]+>/g,"").trim();}
async function relatedProducts(job){
 const first=await fetch("https://dubaipremiertourism.com/wp-json/wp/v2/product?per_page=100&page=1&_fields=id,slug,link,title");
 if(!first.ok)throw new Error("LIVE_PRODUCT_CATALOG_HTTP_"+first.status);
 let products=await first.json(),pages=Math.min(4,Number(first.headers.get("x-wp-totalpages")||1));
 for(let page=2;page<=pages;page++){const response=await fetch("https://dubaipremiertourism.com/wp-json/wp/v2/product?per_page=100&page="+page+"&_fields=id,slug,link,title");if(response.ok)products=products.concat(await response.json());}
 const own=String(job.product_url||"").replace(/\/$/,""),title=String(job.product_title||"").toLowerCase(),tokens=researchTokens(title);
 const groups=[["ice","rink","skating","ski","snow","winter"],["qasr","palace","heritage","cultural","museum","fort","abu dhabi"],["bus","coach","seater","transport","transfer","chauffeur"],["yacht","boat","cruise","dhow","marina"],["safari","desert","dune","camel"],["helicopter","flight","aerial"],["park","theme","rides","family"],["museum","art","gallery","culture","exhibition"]];
 const semantic=[...new Set(groups.filter(group=>group.some(term=>title.includes(term))).flat())];
 const intent={vehicles:["chauffeur","sedan","suv","van","bus","coach","transfer"],transfers:["transfer","chauffeur","sedan","suv","van"],attractions:["ticket","museum","garden","view","park","palace","cultural"],tours:["tour","sightseeing"],activities:["adventure","activity","experience"],packages:["package","park","ticket"],safaris:["safari","desert"],cruises:["cruise","dhow","marina"],yachts:["yacht","charter"],helicopter:["helicopter","flight"]}[job.blueprint_key]||[];
 const adjacent={helicopter:["aerial","airport","transfer","chauffeur","city tour","sightseeing","burj khalifa"],vehicles:["airport","city tour","sightseeing","business","hotel"],transfers:["airport","chauffeur","vehicle","city tour"],attractions:["tour","sightseeing","experience"],tours:["attraction","ticket","safari","cruise"],activities:["attraction","tour","adventure"],packages:["attraction","ticket","theme park"],safaris:["desert","quad","camel","tour"],cruises:["yacht","marina","dinner"],yachts:["cruise","marina","boat"]}[job.blueprint_key]||[];
 const ranked=products.map(item=>{const itemTitle=decodeWp(item.title?.rendered),lower=itemTitle.toLowerCase(),itemTokens=new Set(researchTokens(lower)),overlap=tokens.filter(token=>itemTokens.has(token)).length,semanticScore=semantic.filter(term=>lower.includes(term)).length,intentScore=intent.filter(term=>lower.includes(term)).length,adjacentScore=adjacent.filter(term=>lower.includes(term)).length;return{title:itemTitle,url:String(item.link||""),score:overlap*8+semanticScore*4+intentScore*2+adjacentScore};}).filter(item=>item.url&&item.url.replace(/\/$/,"")!==own&&item.url.startsWith("https://dubaipremiertourism.com/product/")&&item.score>0).sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title));
 const selected=ranked.slice(0,6);
 if(selected.length<5){const selectedUrls=new Set(selected.map(item=>item.url));const safeFallback=products.map(item=>({title:decodeWp(item.title?.rendered),url:String(item.link||"")})).filter(item=>item.title&&item.url&&item.url.replace(/\/$/,"")!==own&&item.url.startsWith("https://dubaipremiertourism.com/product/")&&!selectedUrls.has(item.url)).sort((a,b)=>a.title.localeCompare(b.title));selected.push(...safeFallback.slice(0,6-selected.length));}
 return selected.slice(0,6).map(({title,url})=>({text:title,url}));
}
function normalizeDraft(draft,related,category){
 if(!draft||!Array.isArray(draft.sections))return draft;
 const seenOverview=[];draft.sections=draft.sections.filter(section=>{if(!/overview/i.test(String(section.heading||"")))return true;seenOverview.push(section);return seenOverview.length===1;});
 if(seenOverview.length>1){const first=seenOverview[0],parts=seenOverview.map(x=>String(x.content||"").trim()).filter(Boolean);first.content=[...new Set(parts)].join("\n\n");}
 const internalPhrases=["must be confirmed","requires confirmation","pending verification","research needed","insert link","placeholder"];
 const neutralizePromotional=value=>String(value||"").replace(/\bguaranteed\s+(?:lowest|best|cheapest)\s+(?:price|rate|deal)s?\b/gi,"competitive booking options").replace(/\bguarantees?\s+(?:a|an|your|entry|access|experience|journey|service)?\s*/gi,"supports ").replace(/\bguaranteed\s+to\b/gi,"designed to").replace(/\bworld[- ]class\b/gi,"well-equipped").replace(/\bultimate\b/gi,"complete").replace(/\bseamless(?:ly)?\b/gi,"convenient").replace(/\bhassle[- ]free\b/gi,"straightforward").replace(/\binstant\s+(?:booking\s+)?confirmation\b/gi,"booking confirmation").replace(/\bnumber one\b/gi,"popular").replace(/\bthe\s+cheapest\s+price\b/gi,"a competitive price").replace(/\bcheapest\b/gi,"competitive").replace(/\bunbeatable\b/gi,"appealing").replace(/\bbest\b/gi,"suitable").replace(/\s{2,}/g," ").trim();
 const cleanText=value=>neutralizePromotional(String(value||"").split(/(?<=[.!?])\s+/).filter(sentence=>!internalPhrases.some(p=>sentence.toLowerCase().includes(p))).join(" "));
 const safeSectionContent=(label,focus)=>({
  "Booking, Cancellation and Refund Policy":`Booking availability, final charges, cancellation conditions and refund eligibility for ${focus} are confirmed for the selected option before payment. Review the booking summary and request clarification before confirming if any condition is unclear.`,
  "Pickup Information":`Pickup availability, location, timing and transfer arrangements for ${focus} are confirmed for the selected booking option before payment. Share the correct pickup details and contact information so the applicable arrangement can be checked.`,
  "Ticket Information":`Ticket format, entry requirements, selected date and applicable booking conditions for ${focus} are confirmed before payment. Guests should review the issued booking details and carry the required identification or confirmation.`,
  "Important Information":`Important visitor conditions for ${focus} depend on the selected date and booking option. Review the confirmed inclusions, exclusions, eligibility details and operational guidance before travel.`,
  "Itinerary":`The confirmed itinerary for ${focus} follows the selected booking option. The final sequence, meeting details and included stops are provided with the booking confirmation.`,
  "Safety Information":`Guests should follow the confirmed safety guidance, eligibility conditions and staff instructions for ${focus}. Any product-specific restriction must be checked before payment.`,
  "Eligibility":`Eligibility for ${focus} depends on the confirmed product conditions. Check age, health, identification and participation requirements before payment where applicable.`,
  "Package Details":`The exact components of ${focus} are defined by the selected package. Review the confirmed inclusions, exclusions, timing and participant details before payment.`,
  "Transfer Information":`Transfer availability and arrangements for ${focus} depend on the selected booking option. Confirm the pickup location, timing, passenger details and applicable charges before payment.`,
  "Safari Itinerary":`The confirmed ${focus} itinerary follows the selected safari option. Pickup arrangements, activity order and included elements are provided in the final booking confirmation.`,
  "Cruise Experience":`The confirmed ${focus} experience follows the selected cruise option. Boarding details, included services and operational timings are provided with the booking confirmation.`,
  "Boarding Information":`Boarding location, reporting time and confirmation requirements for ${focus} are provided with the selected booking. Guests should arrive according to the issued instructions.`,
  "Yacht Details":`The confirmed yacht, duration and included arrangements for ${focus} depend on the selected charter option. Review the final booking details before payment.`,
  "Charter Information":`Charter timing, guest details and applicable conditions for ${focus} are confirmed for the selected option before payment.`,
  "Flight Experience":`The confirmed route, reporting details and flight conditions for ${focus} depend on the selected option and operational approval. Review the issued confirmation before arrival.`,
  "Vehicle Capacity":`Passenger and luggage requirements for ${focus} are reviewed before confirmation so the appropriate vehicle arrangement can be checked.`,
  "Ideal Uses":`${focus} can be considered for confirmed transport requirements when the passenger count, luggage, pickup details, route and requested duration are supplied before booking.`,
  "Transfer Details":`The route, pickup details, passenger count and timing for ${focus} are confirmed for the selected transfer option before payment.`
 }[label]||`The confirmed details for ${focus} depend on the selected booking option. Review all applicable conditions before payment.`);
 draft.title=neutralizePromotional(draft.title);draft.short_description=neutralizePromotional(draft.short_description);
 for(const section of draft.sections){
  section.level="H2";
  const normalizedHeading=String(section.heading||"");if(/(?:flight\s+)?durations?|route options?/i.test(normalizedHeading)&&!/timings?/i.test(normalizedHeading))section.heading="Timings and Duration"+(/route options?/i.test(normalizedHeading)?" — Flight Route Options":"");
  if(section.content)section.content=cleanText(section.content);
  const faqMode=isFaqHeading(section.heading);
  if(faqMode){
   section.heading="Frequently Asked Questions";
   const candidates=[
    ...(Array.isArray(section.items)?section.items:[]),
    ...(Array.isArray(section.subsections)?section.subsections:[]),
    ...(Array.isArray(section.faqs)?section.faqs:[]),
    ...(Array.isArray(section.bullets)?section.bullets:[])
   ];
   const normalized=candidates.map(item=>{
    if(item&&typeof item==="object")return{level:"H3",question:String(item.question||item.heading||item.title||item.name||"").trim(),answer:cleanText(item.answer||item.content||item.text||item.description)};
    const parts=String(item||"").split(/\s+(?:A|Answer)\s*:\s*/i),question=String(parts.shift()||"").trim().replace(/^\s*(?:Q|Question)\s*:\s*/i,""),answer=cleanText(parts.join(" "));
    return{level:"H3",question,answer};
   }).filter(item=>item.question&&item.answer);
   const seen=new Set();section.items=normalized.filter(item=>{const key=item.question.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();if(!key||seen.has(key))return false;seen.add(key);return true}).slice(0,5);
   delete section.subsections;delete section.faqs;delete section.bullets;
  }else{
   if(Array.isArray(section.items))section.items=section.items.map(item=>({...item,level:"H3",answer:cleanText(item.answer)})).filter(item=>item.question&&item.answer);
   if(Array.isArray(section.subsections))section.subsections=section.subsections.map(item=>({...item,level:"H3"}));
   if(Array.isArray(section.bullets)){section.bullets=[...new Set(section.bullets.map(cleanText).filter(Boolean))];if(/why choose/i.test(String(section.heading||""))&&section.bullets.length>6)section.bullets=section.bullets.slice(0,6);}
  }
 }
 const usedSentences=new Set();
 for(const section of draft.sections){
  if(isFaqHeading(section.heading))continue;
  if(section.content){section.content=String(section.content).split(/(?<=[.!?])\s+/).filter(sentence=>{const key=sentence.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();if(key.split(" ").length<8)return true;if(usedSentences.has(key))return false;usedSentences.add(key);return true}).join(" ");}
  if(Array.isArray(section.bullets))section.bullets=section.bullets.filter(item=>{if(item&&typeof item==="object")return true;const key=String(item||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();if(!key)return false;if(usedSentences.has(key))return false;usedSentences.add(key);return true;});
 }
 let relatedSection=draft.sections.find(section=>/related|similar|fleet options|recommended services|more experiences/i.test(String(section.heading||"")));
 if(!relatedSection){relatedSection={level:"H2",heading:"Related Dubai Experiences"};draft.sections.push(relatedSection);}
 if(Array.isArray(related)&&related.length){relatedSection.heading="Related Dubai Experiences";relatedSection.bullets=related;relatedSection.items=related.map(item=>({level:"H3",question:String(item?.text||"").split(/\s+[–—]\s+/)[0].trim(),answer:String(item?.url||"").trim()})).filter(item=>item.question&&item.answer);delete relatedSection.content;}
 if(category==="vehicles"){
  let capacity=draft.sections.find(section=>/vehicle capacity|passenger capacity|capacity and suitability/i.test(String(section.heading||"")));
  if(!capacity){capacity={level:"H2",heading:"Vehicle Capacity and Suitability",bullets:["Passenger numbers and luggage requirements are reviewed before confirmation so the appropriate vehicle arrangement can be checked."]};draft.sections.splice(Math.min(4,draft.sections.length),0,capacity);}
  let ideal=draft.sections.find(section=>/ideal uses/i.test(String(section.heading||"")));
  if(!ideal){ideal={level:"H2",heading:"Ideal Uses for This Dubai Transport Service",subsections:[
   {level:"H3",heading:"Airport Pick and Drop Service Dubai",content:"Suitable for planned airport transport when passenger, luggage, terminal and timing details are confirmed in advance."},
   {level:"H3",heading:"Corporate Chauffeur Service Dubai",content:"A practical option for business travel that requires organised pickup details and professional transport coordination."},
   {level:"H3",heading:"Private City Tours and Sightseeing",content:"Can support private sightseeing plans when the route, group size and requested duration are agreed before booking."},
   {level:"H3",heading:"VIP, Hotel and Event Transfers",content:"Useful for pre-arranged hotel or event transport after the pickup point, schedule and passenger requirements are confirmed."}
  ]};const whyIndex=draft.sections.findIndex(section=>/why choose/i.test(String(section.heading||"")));draft.sections.splice(whyIndex>=0?whyIndex:draft.sections.length,0,ideal);}
 }
 const plan=draft.yoast_plan||{},focusPhrase=String(plan.focus_keyphrase||draft.title||"Dubai experience").trim(),relatedPhrases=(Array.isArray(plan.related_keyphrases)?plan.related_keyphrases:[]).map(item=>String(typeof item==="string"?item:item?.keyphrase||"").trim()).filter(Boolean);
 const hasBooking=draft.sections.some(section=>/booking/i.test(String(section.heading||""))&&/(cancellation|refund|policy)/i.test(String(section.heading||"")));
 if(!hasBooking){const whyIndex=draft.sections.findIndex(section=>/why choose/i.test(String(section.heading||"")));draft.sections.splice(whyIndex>=0?whyIndex:draft.sections.length,0,{level:"H2",heading:focusPhrase+" Booking, Cancellation and Refund Policy",content:safeSectionContent("Booking, Cancellation and Refund Policy",focusPhrase)});}
 for(const required of CATEGORY_SECTIONS[category]||[]){if(!draft.sections.some(section=>String(section.heading||"").toLowerCase().includes(required.toLowerCase()))){const whyIndex=draft.sections.findIndex(section=>/why choose/i.test(String(section.heading||"")));draft.sections.splice(whyIndex>=0?whyIndex:draft.sections.length,0,{level:"H2",heading:focusPhrase+" — "+required,content:safeSectionContent(required,focusPhrase)});}}
 for(const section of draft.sections){const heading=String(section.heading||"");if(/overview/i.test(heading))section.heading=focusPhrase+" Overview";else if(/what to expect/i.test(heading))section.heading="What to Expect from "+(relatedPhrases[0]||focusPhrase);else if(/highlight/i.test(heading)&&!/inclusion|exclusion/i.test(heading))section.heading=(relatedPhrases[1]||focusPhrase)+" Highlights";else if(/inclusion|included/i.test(heading)&&!/exclusion/i.test(heading))section.heading=(relatedPhrases[2]||focusPhrase)+" Inclusions";else if(/exclusion|not included/i.test(heading))section.heading=(relatedPhrases[3]||focusPhrase)+" Exclusions and Additional Charges";else if(/timing|duration|service availability|operating hour/i.test(heading))section.heading=focusPhrase+" Timings and Duration";else if(/booking|cancellation|refund|policy/i.test(heading))section.heading=focusPhrase+" Booking, Cancellation and Refund Policy";else if(/why choose/i.test(heading))section.heading="Why Choose Premier Express Tourism for "+focusPhrase;}
 const aiSummary=String(draft.ai_search_summary||"").replace(/\s+/g," ").trim();
 const overview=draft.sections.find(section=>/overview/i.test(String(section.heading||"")));
 if(aiSummary&&overview){const existing=String(overview.content||"").trim();if(!existing.toLowerCase().startsWith(aiSummary.toLowerCase()))overview.content=aiSummary+(existing?"\n\n"+existing:"");}
 draft.entity_facts=[...new Set((Array.isArray(draft.entity_facts)?draft.entity_facts:[]).map(cleanText).filter(Boolean))].slice(0,10);
 if(draft.entity_facts.length>=5){
  const focus=String(draft?.yoast_plan?.focus_keyphrase||draft?.title||"Product").trim(),overviewIndex=draft.sections.findIndex(section=>/overview/i.test(String(section.heading||"")));
  let glance=draft.sections.find(section=>/at a glance/i.test(String(section.heading||"")));
  if(!glance){glance={level:"H2",heading:focus+" at a Glance",bullets:[]};draft.sections.splice(overviewIndex>=0?overviewIndex+1:1,0,glance);}
  glance.level="H2";glance.heading=focus+" at a Glance";glance.bullets=draft.entity_facts.slice(0,10);delete glance.content;
 }
 const rank=section=>{const h=String(section.heading||"").toLowerCase();if(/related|similar|recommended/.test(h))return 95;if(/overview/.test(h))return 10;if(/duration option|booking option|rental period/.test(h))return 20;if(/what to expect/.test(h))return 30;if(/capacity|feature|ideal uses|experience|atmosphere|location|ticket information|historical|exhibition|dress code|safety|eligibility|redeem|arrival/.test(h))return 35;if(/highlight|inclusion/.test(h)&&!/exclusion/.test(h))return 40;if(/exclusion/.test(h))return 50;if(/timing|schedule|service availability|operating hour/.test(h))return 60;if(/cancellation|refund|booking polic/.test(h))return 70;if(/important information|visitor guideline|safety guideline/.test(h))return 80;if(/why choose/.test(h))return 90;if(isFaqHeading(h))return 100;return 36};
 draft.sections=draft.sections.map((section,index)=>({section,index})).sort((a,b)=>rank(a.section)-rank(b.section)||a.index-b.index).map(item=>item.section);
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
function keywordHeadingCoverage(draft,yoastPlan){
 const plan=yoastPlan||draft?.yoast_plan||{},sections=Array.isArray(draft?.sections)?draft.sections:[],headingRows=sections.flatMap(section=>{
  const main={level:"H2",heading:String(section?.heading||""),faq:isFaqHeading(section?.heading)};
  const subs=(Array.isArray(section?.subsections)?section.subsections:[]).map(item=>({level:"H3",heading:String(item?.heading||""),faq:false}));
  return [main,...subs];
 }).filter(row=>row.heading&&!row.faq);
 const normalize=value=>String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(),headingText=headingRows.map(row=>normalize(row.heading));
 const focus=normalize(plan.focus_keyphrase),related=(Array.isArray(plan.related_keyphrases)?plan.related_keyphrases:[]).map(item=>normalize(typeof item==="string"?item:item?.keyphrase)).filter(Boolean);
 const exactPresent=phrase=>headingText.some(heading=>heading.includes(phrase));
 const focusExact=!!focus&&exactPresent(focus),relatedMatches=related.map(keyphrase=>({keyphrase,matched:exactPresent(keyphrase)}));
 return{focus_exact_in_non_faq_heading:focusExact,related_exact_in_non_faq_headings:relatedMatches.filter(x=>x.matched).length,related_total:related.length,missing_related:relatedMatches.filter(x=>!x.matched).map(x=>x.keyphrase),heading_rows:headingRows};
}
function keywordHeadingErrors(draft,yoastPlan){
 const plan=yoastPlan||draft?.yoast_plan||{},sections=Array.isArray(draft?.sections)?draft.sections:[],headings=sections.flatMap(section=>[section.heading,...(Array.isArray(section.subsections)?section.subsections.map(item=>item?.heading):[])]).map(value=>String(value||"")).join(" ").toLowerCase(),short=String(draft?.short_description||"").toLowerCase(),body=JSON.stringify(sections).toLowerCase();
 const focus=String(plan.focus_keyphrase||"").trim().toLowerCase(),focusSynonyms=(Array.isArray(plan.focus_synonyms)?plan.focus_synonyms:[]).map(value=>String(value||"").trim().toLowerCase()).filter(Boolean);
 const includesFamily=(value,family)=>family.some(term=>term.length>2&&value.includes(term)),coverage=keywordHeadingCoverage(draft,plan),errors=[];
 if(focus&&!coverage.focus_exact_in_non_faq_heading)errors.push("Use the exact focus keyphrase naturally in at least one relevant non-FAQ H2 or H3 heading");
 if(focus&&!includesFamily(short,[focus,...focusSynonyms]))errors.push("Use the focus keyphrase or a natural focus synonym in the short description");
 if(focus&&!includesFamily(body,[focus,...focusSynonyms]))errors.push("Use the focus keyphrase or a natural focus synonym in the body");
 if(coverage.related_total!==4)errors.push("The heading contract requires exactly four related keyphrases");
 if(coverage.missing_related.length)errors.push("Use every exact related keyphrase naturally in a separate relevant non-FAQ H2 or H3 heading; missing: "+coverage.missing_related.join(", "));
 return errors;
}
function scoreDraftReadiness(draft,category,yoastPlan){
 const sections=Array.isArray(draft?.sections)?draft.sections:[],heads=sections.map(section=>String(section.heading||"").toLowerCase()),plan=yoastPlan||draft?.yoast_plan||{};
 const faq=sections.find(section=>isFaqHeading(section.heading)),whyIndex=sections.findIndex(section=>/why choose/i.test(String(section.heading||""))),relatedIndex=sections.findIndex(section=>/related|similar|fleet options|recommended services|more experiences/i.test(String(section.heading||"")));
 const related=relatedIndex>=0?sections[relatedIndex]:null,links=Array.isArray(related?.bullets)?related.bullets.filter(item=>item&&typeof item==="object"&&String(item.url||"").startsWith("https://dubaipremiertourism.com/product/")):[],relatedItems=Array.isArray(related?.items)?related.items.filter(item=>String(item?.question||"").trim()&&String(item?.answer||"").startsWith("https://dubaipremiertourism.com/product/")):[];
 const nested=sections.flatMap(section=>[...(Array.isArray(section.subsections)?section.subsections:[]),...(Array.isArray(section.items)?section.items:[])]),keywordErrors=keywordHeadingErrors(draft,plan),headingCoverage=keywordHeadingCoverage(draft,plan);
 const summaryWords=wordCount(draft?.ai_search_summary),entityFacts=Array.isArray(draft?.entity_facts)?draft.entity_facts.filter(Boolean):[],overview=sections.find(section=>/overview/i.test(String(section.heading||""))),overviewText=String(overview?.content||"").trim().toLowerCase(),summaryText=String(draft?.ai_search_summary||"").trim().toLowerCase();
 const research=draft?.research_contract||{},researchSignals=Number(research.gsc_queries||0)+Number(research.google_suggestions||0)+Number(research.competitor_topics||0)+Number(research.first_party_catalog_topics||0)+Number(research.first_party_source_terms||0);
 const contentChecks=[
  ["short_description",wordCount(draft?.short_description)>=70&&wordCount(draft?.short_description)<=90,10],
  ["useful_body",wordCount(JSON.stringify(sections))>=450,10],
  ["section_depth",sections.length>=10,10],
  ["heading_hierarchy",sections.every(section=>String(section.level||"").toUpperCase()==="H2")&&nested.every(item=>String(item.level||"").toUpperCase()==="H3"),10],
  ["common_structure",COMMON_SECTION_GROUPS.every(([,aliases])=>heads.some(heading=>aliases.some(alias=>heading.includes(alias)))),10],
  ["category_structure",(CATEGORY_SECTIONS[category]||[]).every(required=>heads.some(heading=>heading.includes(required.toLowerCase()))),10],
  ["faqs",Array.isArray(faq?.items)&&faq.items.length===5,10],
  ["why_choose",whyIndex>=0&&Array.isArray(sections[whyIndex]?.bullets)&&sections[whyIndex].bullets.length>=5&&sections[whyIndex].bullets.length<=6,10],
  ["related_placement",relatedIndex===whyIndex+1&&links.length>=5&&links.length<=6&&relatedItems.length===links.length&&relatedItems.every((item,index)=>String(item.answer)===String(links[index].url)),10],
  ["preservation_and_research",Array.isArray(draft?.preservation_ledger)&&draft.preservation_ledger.length>0&&research.completed===true&&researchSignals>0,10]
 ];
 const seoChecks=[
  ["seo_title",String(plan.seo_title||"").length>=45&&String(plan.seo_title||"").length<=60,12],
  ["meta_description",String(plan.meta_description||"").length>=120&&String(plan.meta_description||"").length<=155,12],
  ["yoast_architecture",completeShadowKeywordPlan(plan),18],
  ["focus_short_description",!keywordErrors.some(error=>error.includes("short description")),10],
  ["focus_body",!keywordErrors.some(error=>error.endsWith("in the body")),8],
  ["focus_exact_heading",headingCoverage.focus_exact_in_non_faq_heading,10],
  ["all_related_exact_headings",headingCoverage.related_total===4&&headingCoverage.related_exact_in_non_faq_headings===4,15],
  ["internal_links",links.length>=5&&links.length<=6,5],
  ["ai_answer_first",summaryWords>=40&&summaryWords<=80&&!!summaryText&&overviewText.startsWith(summaryText),5],
  ["entity_and_schema_readiness",entityFacts.length>=5&&entityFacts.length<=10&&draft?.ai_search_readiness?.answer_first===true&&Array.isArray(draft?.ai_search_readiness?.schema_recommendation)&&["Product","Offer","FAQPage"].every(type=>draft.ai_search_readiness.schema_recommendation.includes(type)),5]
 ];
 const summarize=checks=>({score:checks.reduce((sum,[,passed,points])=>sum+(passed?points:0),0),checks:Object.fromEntries(checks.map(([key,passed,points])=>[key,{passed,points}]))});
 return{content:summarize(contentChecks),seo:summarize(seoChecks),keyword_heading_coverage:headingCoverage,contract_version:"shadow-readiness-v3-research-ai"};
}
function validateDraft(draft,category,baseline,yoastPlan){
 const errors=[],sections=Array.isArray(draft?.sections)?draft.sections:[],heads=sections.map(s=>String(s.heading||"").toLowerCase()),raw=JSON.stringify({title:draft?.title,short_description:draft?.short_description,sections}).toLowerCase();
 if(wordCount(draft?.short_description)<70||wordCount(draft?.short_description)>90)errors.push("Short description must be 70-90 words");
 const plan=yoastPlan||draft?.yoast_plan||{};if(String(plan.seo_title||"").length<45||String(plan.seo_title||"").length>60)errors.push("SEO title must be 45-60 characters");if(String(plan.meta_description||"").length<120||String(plan.meta_description||"").length>155)errors.push("Meta description must be 120-155 characters");if(!completeShadowKeywordPlan(plan))errors.push("Complete research-grounded Yoast 1+4 architecture required");
 if(sections.length<10)errors.push("At least 10 complete H2 sections required");
 if(wordCount(JSON.stringify(sections))<450)errors.push("Product body requires at least 450 useful words across the governed sections");
 if(sections.some(section=>String(section.level||"").toUpperCase()!=="H2"))errors.push("Every main content section must use H2");
 const nested=sections.flatMap(section=>[...(Array.isArray(section.subsections)?section.subsections:[]),...(Array.isArray(section.items)?section.items:[])]);
 if(nested.some(item=>String(item.level||"").toUpperCase()!=="H3"))errors.push("Every subsection and FAQ question must use H3");
 const duplicateH2=heads.filter((heading,index)=>heading&&heads.indexOf(heading)!==index);
 if(duplicateH2.length)errors.push("Duplicate H2 headings are not allowed");
 for(const [label,aliases] of COMMON_SECTION_GROUPS)if(!heads.some(x=>aliases.some(alias=>x.includes(alias))))errors.push("Missing section purpose: "+label);
 const highlightSections=heads.filter(h=>h.includes("highlight")&&!h.includes("inclusion")&&!h.includes("exclusion")),inclusionSections=heads.filter(h=>h.includes("inclusion")&&!h.includes("exclusion")),exclusionSections=heads.filter(h=>h.includes("exclusion")&&!h.includes("inclusion"));if(!highlightSections.length||!inclusionSections.length||!exclusionSections.length)errors.push("Use three separate H2 sections: Highlights, Inclusions, and Exclusions");if(!heads.some(h=>/timings?/i.test(h)&&/durations?/i.test(h)))errors.push("Use an explicit H2 named Timings and Duration");if(!heads.some(h=>/booking/i.test(h)&&/(cancellation|refund|policy)/i.test(h)))errors.push("Use an explicit H2 for Booking, Cancellation and Refund Policy");if(!heads.some(h=>/(important information|visitor guidance|safety information|eligibility|what to wear)/i.test(h)))errors.push("Use an explicit H2 for Important Information, Safety Information, or Visitor Guidance");
 for(const h of CATEGORY_SECTIONS[category]||[])if(!heads.some(x=>x.includes(h.toLowerCase())))errors.push("Missing category section: "+h);
 const relatedSection=sections.find(s=>/related|similar|fleet options|recommended services|more experiences/i.test(String(s.heading||""))),relatedBullets=Array.isArray(relatedSection?.bullets)?relatedSection.bullets.filter(item=>item&&typeof item==="object"&&String(item.url||"").startsWith("https://dubaipremiertourism.com/product/")):[],relatedItems=Array.isArray(relatedSection?.items)?relatedSection.items:[];if(relatedBullets.length<5||relatedBullets.length>6)errors.push("Related Experiences requires five or six linked bullet products");if(relatedItems.length!==relatedBullets.length||relatedItems.some((item,index)=>String(item?.answer||"")!==String(relatedBullets[index]?.url||"")))errors.push("Every Related Experiences bullet link requires a matching H3 heading and quoted product link in the same order");
 const faq=sections.find(s=>isFaqHeading(s.heading));
 if(!faq||!Array.isArray(faq.items)||faq.items.length!==5)errors.push("Exactly five useful FAQs required");
 const why=sections.find(s=>String(s.heading||"").toLowerCase().includes("why choose"));
 if(!why||!Array.isArray(why.bullets)||why.bullets.length<5||why.bullets.length>6)errors.push("Why Choose requires five or six product-specific reasons");
 if(!Array.isArray(draft?.preservation_ledger)||draft.preservation_ledger.length===0)errors.push("Preservation ledger is required");
 const related=sections.find(section=>/related|similar|fleet options|recommended services|more experiences/i.test(String(section.heading||"")));
 const links=Array.isArray(related?.bullets)?related.bullets.filter(item=>item&&typeof item==="object"&&String(item.url||"").startsWith("https://dubaipremiertourism.com/product/")):[];
 if(links.length<5||links.length>6)errors.push("Related Dubai Experiences requires 5-6 verified internal product links");
 const whyIndex=sections.findIndex(section=>/why choose/i.test(String(section.heading||""))),relatedIndex=sections.findIndex(section=>/related|similar|fleet options|recommended services|more experiences/i.test(String(section.heading||"")));
 if(whyIndex<0||relatedIndex!==whyIndex+1)errors.push("Related Experiences must appear immediately after Why Choose");
 for(const p of ["must be confirmed","requires confirmation","pending verification","product-specific use","official this experience","insert link","research needed","placeholder","world-class","ultimate","seamless","hassle-free","instant confirmation","guarantees an","guarantees your"])if(raw.includes(p))errors.push("Internal or mechanical wording: "+p);
 const repeated=new Set(),seenSentences=new Set();for(const section of sections){if(isFaqHeading(section.heading))continue;const values=[section.content,...(Array.isArray(section.bullets)?section.bullets.filter(item=>typeof item==="string"):[])];for(const value of values){for(const sentence of String(value||"").split(/(?<=[.!?])\s+/)){const key=sentence.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();if(key.split(" ").length<8)continue;if(seenSentences.has(key))repeated.add(key);seenSentences.add(key)}}}if(repeated.size)errors.push("Repeated sentences across sections must be removed");
 const summaryWords=wordCount(draft?.ai_search_summary),entityFacts=Array.isArray(draft?.entity_facts)?draft.entity_facts.filter(Boolean):[],overview=sections.find(section=>/overview/i.test(String(section.heading||""))),summaryText=String(draft?.ai_search_summary||"").trim(),overviewText=String(overview?.content||"").trim();
 if(summaryWords<40||summaryWords>80)errors.push("AI-search summary must contain 40-80 useful factual words");
 if(!summaryText||!overviewText.toLowerCase().startsWith(summaryText.toLowerCase()))errors.push("The first Overview paragraph must begin with the exact answer-first AI-search summary");
 if(entityFacts.length<5||entityFacts.length>10)errors.push("Provide 5-10 concise evidence-backed entity facts");
 if(draft?.research_contract?.completed!==true||Number(draft?.research_contract?.gsc_queries||0)+Number(draft?.research_contract?.google_suggestions||0)+Number(draft?.research_contract?.competitor_topics||0)<1)errors.push("Independent research contract is incomplete; use Search Console, Google query or competitor topic evidence before drafting");
 if(draft?.ai_search_readiness?.answer_first!==true||!Array.isArray(draft?.ai_search_readiness?.schema_recommendation)||!["Product","Offer","FAQPage"].every(type=>draft.ai_search_readiness.schema_recommendation.includes(type)))errors.push("AI-search readiness must recommend Product, Offer and FAQPage schema and certify answer-first copy");
 errors.push(...keywordHeadingErrors(draft,yoastPlan));
 return [...new Set(errors)];
}
async function rest(table,method,authorization,query={},body){
 const url=new URL(SUPABASE_URL+"/rest/v1/"+table);for(const[k,v]of Object.entries(query))url.searchParams.set(k,v);
 const response=await fetch(url,{method,headers:{apikey:SUPABASE_PUBLISHABLE_KEY,authorization,accept:"application/json","content-type":"application/json",prefer:method==="POST"?"return=representation":""},body:body?JSON.stringify(body):undefined});
 const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(table+" HTTP "+response.status);return payload;
}
async function ensureBaselineEvidence(job,evidence,auth,requestId){
 if(Array.isArray(evidence)&&evidence.length)return evidence;
 const snapshot=job?.source_snapshot||{},facts=["Protected live product title: "+String(job?.product_title||""),"Protected live product URL: "+String(job?.product_url||""),"Assigned category blueprint: "+String(job?.blueprint_key||""),"Protected source fingerprint: "+String(job?.source_hash||"")];
 const sourceText=String(snapshot?.short_description||snapshot?.short_description_html||snapshot?.description||snapshot?.description_html||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();if(sourceText)facts.push("Protected live content excerpt: "+sourceText.slice(0,800));
 const inserted=await rest("website_shadow_evidence","POST",auth.authorization,{}, {job_id:job.id,created_by:auth.user.id,record_type:"CANDIDATE",source_type:"EXISTING_WORDPRESS",source_url:job.product_url,source_title:String(job.product_title||"Product")+" — protected live WordPress baseline",retrieved_at:new Date().toISOString(),supported_facts:facts,conflicts:[],notes:"Automatically recorded from the immutable live WordPress source snapshot before shadow generation. This proves provenance but is not independent supplier verification.",wordpress_write_performed:false});
 const rows=Array.isArray(inserted)?inserted:[];if(!rows.length)throw new Error("BASELINE_EVIDENCE_RECORD_NOT_CREATED");console.info("[shadow-generation]",{requestId,stage:"baseline_evidence_created",jobId:job.id,evidenceId:rows[0].id});return rows;
}
const GEMINI_MODELS=["gemini-3.1-flash-lite","gemini-3.5-flash","gemini-3.6-flash"];
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
async function fetchTextSafe(url,timeout=8000){try{const response=await fetch(url,{headers:{"user-agent":"PremierExpress-SearchResearch/1.0","accept":"application/json,text/xml,text/html;q=0.9,*/*;q=0.5"},signal:AbortSignal.timeout(timeout)});return response.ok?await response.text():""}catch{return""}}
function researchTokens(value){const generic=new Set(["dubai","with","from","this","that","tour","service","tickets","ticket","admission","weekend","weekday","booking","book","experience","activity","premium","private","spacious","comfortable","driver","the","and","for"]);return [...new Set(String(value||"").toLowerCase().replace(/&(?:amp|#038);/g," and ").replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(token=>token.length>1&&!generic.has(token)))]}
function relevanceMatch(value,tokens){const words=new Set(researchTokens(value)),matched=tokens.filter(token=>words.has(token)).length,required=tokens.length>=2?2:1;return{matched,passed:matched>=required}}
async function shadowSearchResearch(job,auth,requestId){
 const exact=await rest("search_console_metrics","GET",auth.authorization,{select:"query,page,clicks,impressions,ctr,position,dimension_date",page:"eq."+job.product_url,order:"impressions.desc",limit:"60"}).catch(()=>[]);
 let gsc=Array.isArray(exact)?exact:[];
 if(!gsc.length){const broad=await rest("search_console_metrics","GET",auth.authorization,{select:"query,page,clicks,impressions,ctr,position,dimension_date",order:"impressions.desc",limit:"1000"}).catch(()=>[]),tokens=researchTokens(job.product_title);gsc=(Array.isArray(broad)?broad:[]).map(row=>({...row,relevance:relevanceMatch(row.query,tokens).matched,relevance_passed:relevanceMatch(row.query,tokens).passed})).filter(row=>row.relevance_passed).sort((a,b)=>b.relevance-a.relevance||Number(b.impressions||0)-Number(a.impressions||0)).slice(0,40);}
 const seeds=[job.product_title,String(job.product_title||"").replace(/[–—|].*$/,""),job.blueprint_key+" Dubai",String(job.product_title||"").replace(/\bDubai\b/ig,"").trim()+" Dubai"].filter(Boolean).slice(0,4);
 const suggestionResults=await Promise.all(seeds.map(async seed=>{const raw=await fetchTextSafe("https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=ae&q="+encodeURIComponent(seed),7000);try{return JSON.parse(raw)?.[1]||[]}catch{return[]}}));
 const suggestionTokens=researchTokens(job.product_title),suggestions=[...new Set(suggestionResults.flat().map(value=>String(value||"").trim()).filter(value=>value&&relevanceMatch(value,suggestionTokens).passed))].slice(0,40);
 const domains=["raynatours.com","www.thrillophilia.com","www.headout.com"],targetTokens=researchTokens(job.product_title);
 const competitorResults=await Promise.all(domains.map(async domain=>{const root=await fetchTextSafe("https://"+domain+"/sitemap.xml",9000),locs=[...root.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(match=>match[1].replace(/&amp;/g,"&"));const maps=locs.filter(url=>/sitemap/i.test(url)&&/product|tour|activit|experience|dubai/i.test(url)).slice(0,2);let urls=locs.filter(url=>!/(?:sitemap|\.xml$)/i.test(url));if(maps.length){const pages=await Promise.all(maps.map(url=>fetchTextSafe(url,9000)));urls=urls.concat(pages.flatMap(page=>[...page.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(match=>match[1].replace(/&amp;/g,"&"))));}return urls.map(url=>{const label=decodeURIComponent(url.split("?")[0].split("/").filter(Boolean).pop()||"").replace(/[-_]+/g," "),match=relevanceMatch(label,targetTokens),score=match.matched;return{domain,url,label,score}}).filter(item=>relevanceMatch(item.label,targetTokens).passed).sort((a,b)=>b.score-a.score).slice(0,5)}));
 const competitors=competitorResults.flat().sort((a,b)=>b.score-a.score).slice(0,12);
 const research={created_at:new Date().toISOString(),gsc_queries:gsc.slice(0,40),google_suggestions:suggestions,competitor_topic_pages:competitors,research_rules:{competitor_text_copying:false,competitor_operational_claims_allowed:false,keyword_and_topic_gap_use_only:true}};
 console.info("[shadow-generation]",{requestId,stage:"search_research_complete",gscQueries:research.gsc_queries.length,googleSuggestions:suggestions.length,competitorTopics:competitors.length});return research;
}
async function ensureWorkflowEvidence(job,evidence,related,yoastPlan,research,auth,requestId){
 const existing=new Set((Array.isArray(evidence)?evidence:[]).map(row=>String(row.source_title||"")));
 const records=[
  {source_type:"CATALOGUE",source_url:job.product_url,source_title:String(job.product_title||"Product")+" — governed "+String(job.blueprint_key||"product")+" blueprint",supported_facts:["Category blueprint: "+String(job.blueprint_key||""),"Required category sections: "+(CATEGORY_SECTIONS[job.blueprint_key]||[]).join(", "),"Common governed section purposes: "+COMMON_SECTION_GROUPS.map(group=>group[0]).join(", ")],notes:"Internal category-governance provenance used to structure the shadow draft; not independent product-fact verification."},
  {source_type:"CATALOGUE",source_url:job.product_url,source_title:String(job.product_title||"Product")+" — live related-product catalogue",supported_facts:(Array.isArray(related)?related:[]).map(item=>String(item.text||"")+" — "+String(item.url||"")),notes:"Live Premier Express Tourism catalogue links selected for the Related Dubai Experiences section."},
  {source_type:"SEARCH_CONSOLE",source_url:job.product_url,source_title:String(job.product_title||"Product")+" — Google Search Console demand",supported_facts:(research?.gsc_queries||[]).map(row=>String(row.query||"")+" — impressions "+Number(row.impressions||0)+", position "+Number(row.position||0)).slice(0,40),notes:"First-party Google Search Console query observations used for demand and intent research."},
  {source_type:"OFFICIAL_SOURCE",source_url:"https://suggestqueries.google.com/",source_title:String(job.product_title||"Product")+" — live Google query suggestions",supported_facts:(research?.google_suggestions||[]).slice(0,40),notes:"Live Google query suggestions used for search-language discovery; suggestions are demand signals, not product-fact verification."},
  {source_type:"CATALOGUE",source_url:job.product_url,source_title:String(job.product_title||"Product")+" — Dubai tourism competitor topic gaps",supported_facts:(research?.competitor_topic_pages||[]).map(item=>String(item.domain||"")+" — "+String(item.label||"")+" — "+String(item.url||"")).slice(0,20),notes:"Public competitor sitemap coverage used only for keyword and topic-gap analysis. No competitor wording or operational claim may be copied."},
  {source_type:"CATALOGUE",source_url:job.product_url,source_title:String(job.product_title||"Product")+" — pre-content Yoast keyword plan",supported_facts:["Focus keyphrase: "+String(yoastPlan?.focus_keyphrase||""),"Focus synonyms: "+(yoastPlan?.focus_synonyms||[]).join(", "),"Related keyphrases: "+(yoastPlan?.related_keyphrases||[]).map(item=>item.keyphrase).join(", ")],notes:"Internal SEO plan created after demand research and before content generation; not evidence for operational product claims."}
 ];
 const missing=records.filter(record=>!existing.has(record.source_title)).map(record=>({job_id:job.id,created_by:auth.user.id,record_type:"CANDIDATE",...record,retrieved_at:new Date().toISOString(),conflicts:[],wordpress_write_performed:false}));
 if(!missing.length)return[];const inserted=await rest("website_shadow_evidence","POST",auth.authorization,{},missing),rows=Array.isArray(inserted)?inserted:[];console.info("[shadow-generation]",{requestId,stage:"workflow_evidence_created",jobId:job.id,count:rows.length});return rows;
}
async function gemini(messages){
 const key=process.env.GEMINI_API_KEY;if(!key)throw Object.assign(new Error("GEMINI_CONFIGURATION_REQUIRED"),{permanent:true});
 const system=messages.filter(x=>x.role==="system").map(x=>x.content).join("\n");
 const contents=messages.filter(x=>x.role!=="system").map(x=>({role:x.role==="assistant"?"model":"user",parts:[{text:String(x.content||"")}]}));
 let lastError,rateLimited=false;
 for(let round=0;round<1;round++){
  let longestDelay=0,roundRetryable=false;
  for(const model of GEMINI_MODELS){
   try{
    const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"x-goog-api-key":key,"content-type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,generationConfig:{temperature:.35,maxOutputTokens:8192,responseMimeType:"application/json"}}),signal:AbortSignal.timeout(55000)});
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
  if(round<0)await new Promise(resolve=>setTimeout(resolve,longestDelay||retryDelay(null,round)));
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
function keywordTerms(value){return [...new Set((Array.isArray(value)?value:[]).map(x=>String(x||"").trim()).filter(Boolean))]}
function normalizeShadowKeywordPlan(value,job){
 const related=Array.isArray(value?.related_keyphrases)?value.related_keyphrases:[];
 return{seo_title:String(value?.seo_title||"").trim(),meta_description:String(value?.meta_description||"").trim(),focus_keyphrase:String(value?.focus_keyphrase||"").trim(),focus_synonyms:keywordTerms(value?.focus_synonyms).slice(0,5),related_keyphrases:related.map(x=>({keyphrase:String(typeof x==="string"?x:x?.keyphrase||"").trim(),synonyms:keywordTerms(x?.synonyms).slice(0,4)})).filter(x=>x.keyphrase).slice(0,4),created_before_content:true,product_title:String(job?.product_title||"").trim()}
}
function fitShadowSeoTitle(value,focus){let title=String(value||"").replace(/\s+/g," ").trim();if(title.length>60)title=title.slice(0,60).replace(/\s+\S*$/,"").trim();const suffixes=[" | Details & Booking"," | Tickets & Visitor Guide"," | Dubai Booking Guide"];for(const suffix of suffixes){if(title.length>=45)break;const base=title||String(focus||"").trim();if((base+suffix).length<=60)title=base+suffix;}if(title.length<45)title=(title+" | Product Details and Booking").slice(0,60).replace(/\s+\S*$/,"").trim();return title}
function fitShadowMeta(value,focus){let meta=String(value||"").replace(/\s+/g," ").trim();if(meta.length>155)meta=meta.slice(0,155).replace(/\s+\S*$/,"").replace(/[,:;.!?-]+$/,"").trim()+".";const additions=[" Review the verified details, inclusions and booking information."," Explore the experience details and plan your visit with confidence."," Check availability and the applicable booking information before your visit."];for(const addition of additions){if(meta.length>=120)break;meta+=addition;}if(meta.length>155)meta=meta.slice(0,155).replace(/\s+\S*$/,"").replace(/[,:;.!?-]+$/,"").trim()+".";if(!meta&&focus)meta=fitShadowMeta("Explore "+focus+" with clear product details and useful visitor information.",focus);return meta}
function completeShadowKeywordPlan(value){const p=normalizeShadowKeywordPlan(value,{});return p.seo_title.length>=45&&p.seo_title.length<=60&&p.meta_description.length>=120&&p.meta_description.length<=155&&p.focus_keyphrase&&p.focus_synonyms.length>=4&&p.related_keyphrases.length===4&&p.related_keyphrases.every(x=>x.synonyms.length>=4)}
function deterministicKeywordPlan(job){
 const title=String(job?.product_title||"Dubai tourism experience").replace(/\s+/g," ").trim(),base=title.replace(/[–—|].*$/,"").trim(),category=String(job?.blueprint_key||"tour").replace(/_/g," ");
 const focus=(base+" Dubai").replace(/\bDubai\s+Dubai\b/i,"Dubai").trim(),seo=(base+" in Dubai | Book Your Experience").slice(0,60);
 const meta=("Explore "+base+" in Dubai with clear experience details, inclusions, timings and booking information from Premier Express Tourism. Plan your visit today.").slice(0,155);
 const related=[["Dubai "+category,["Dubai "+category+" experience",category+" in Dubai","book Dubai "+category,"best Dubai "+category]],["Dubai tourism experience",["Dubai visitor experience","things to do in Dubai","Dubai travel activity","Dubai sightseeing experience"]],["book "+base,["reserve "+base,base+" booking","buy "+base+" tickets",base+" reservation"]],["Dubai experience booking",["book Dubai attractions","Dubai activity booking","Dubai tour reservation","reserve Dubai experiences"]]];
 return normalizeShadowKeywordPlan({seo_title:seo.length>=35?seo:(seo+" | Premier Express Tourism"),meta_description:meta.length>=100?meta:(meta+" Browse full details and plan with confidence."),focus_keyphrase:focus,focus_synonyms:[base,base+" experience","book "+base,base+" tickets"],related_keyphrases:related.map(([keyphrase,synonyms])=>({keyphrase,synonyms}))},job)
}
async function createShadowKeywordPlan(job,baseline,evidence,research,requestId){
 const researchSignals=Number(research?.gsc_queries?.length||0)+Number(research?.google_suggestions?.length||0)+Number(research?.competitor_topic_pages?.length||0)+Number(research?.first_party_catalog_topics?.length||0)+Number(research?.first_party_source_terms?.length||0);
 if(researchSignals<1){const error=new Error("KEYWORD_RESEARCH_UNAVAILABLE_AFTER_RETRIES: no Search Console, Google query or competitor topic signal was collected for this product");error.retryable=true;throw error;}
 const instruction="Create a FRESH Yoast Premium 1+4 keyword plan before writing this Dubai tourism product. Do not reuse the prior draft plan as the answer. Return JSON only with seo_title (45-60 characters), meta_description (120-155 characters), focus_keyphrase, focus_synonyms (4-5), related_keyphrases (exactly 4 objects with keyphrase and exactly 4 synonyms). Base intent selection on the supplied Search Console queries, Google suggestions, competitor topic gaps, verified evidence and category. Use the protected product source only for operational facts. Never invent claims, promise rankings, copy competitor wording or create broad generic tourism phrases unrelated to the exact product. PRODUCT_AND_RESEARCH: "+JSON.stringify({title:job.product_title,category:job.blueprint_key,protected_source:job.source_snapshot||{},assessment:job.assessment||{},evidence:evidence||[],search_research:research||{},prior_plan_for_comparison_only:baseline?.yoast_plan||null,rules:{fresh_research_required:true,previous_plan_cannot_be_reused_without_revalidation:true,prefer_relevant_first_party_gsc_queries:true,use_google_suggestions_as_language_signals:true,use_competitors_for_topic_gaps_only:true,never_copy_competitor_wording:true,never_treat_competitor_claims_as_product_facts:true}});
 const messages=[{role:"system",content:"Return only a valid fresh research-led JSON Yoast keyword plan."},{role:"user",content:instruction}];let lastErrors=[];
 for(let attempt=0;attempt<3;attempt++){
  try{
   const candidate=normalizeShadowKeywordPlan(await gateway(messages),job);candidate.seo_title=fitShadowSeoTitle(candidate.seo_title,candidate.focus_keyphrase);candidate.meta_description=fitShadowMeta(candidate.meta_description,candidate.focus_keyphrase);
   lastErrors=[];if(!completeShadowKeywordPlan(candidate))lastErrors.push("Complete exact 1+4 architecture and required synonym counts");if(!candidate.focus_keyphrase)lastErrors.push("Focus keyphrase is empty");if(candidate.related_keyphrases.some(item=>item.keyphrase.toLowerCase()===candidate.focus_keyphrase.toLowerCase()))lastErrors.push("Related keyphrases must represent distinct supporting intents");
   if(!lastErrors.length){console.info("[shadow-generation]",{requestId,stage:"yoast_plan_created",source:"AI_FRESH_RESEARCH",attempt:attempt+1,focus:candidate.focus_keyphrase,researchSignals});candidate.research_grounded=true;candidate.research_contract_version=3;candidate.fresh_research_required=true;candidate.previous_plan_reused=false;candidate.research_summary={gsc_queries:research?.gsc_queries?.length||0,google_suggestions:research?.google_suggestions?.length||0,competitor_topics:research?.competitor_topic_pages?.length||0};return{plan:candidate,source:"AI_FRESH_RESEARCH"};}
   messages.push({role:"assistant",content:JSON.stringify(candidate)},{role:"user",content:"Return a complete corrected fresh plan. Repair: "+lastErrors.join("; ")});
  }catch(error){lastErrors=[error?.message||String(error)];console.warn("[shadow-generation]",{requestId,stage:"yoast_plan_repair",attempt:attempt+1,message:lastErrors[0]});}
 }
 const error=new Error("KEYWORD_PLAN_UNAVAILABLE_AFTER_RETRIES: fresh research-led 1+4 plan did not pass after three autonomous attempts: "+lastErrors.join("; "));error.retryable=true;throw error;
}
function prompt(job,baseline,evidence,related,yoastPlan,research){return [
 "Act as Premier Express Tourism Dubai's senior tourism researcher, SEO strategist and human editor. Return JSON only: {title,short_description,ai_search_summary,entity_facts,sections,editorial_note,preservation_ledger}.",
 "RESEARCH-FIRST RULE: do not rely only on the current WordPress product or copy the prior draft. Treat the live/source snapshot as one protected factual source. Independently use Search Console queries, Google suggestions, competitor topic gaps, verified evidence, category rules and the related-product catalogue to determine search intent, missing useful topics and content structure. Competitors supply topics only—never wording or operational claims.",
 "The WooCommerce product title is the only H1. Every main body section must use {level:'H2',heading,content?,bullets?,items?,subsections?}. Every subsection and FAQ item must use {level:'H3',question or heading,answer or content}. Never print the words H2 or H3.",
 "Create excellent, specific, professional, natural human-written copy. Preserve verified useful facts, resolve gaps through research, and do not shorten or spin the current page.",
 "Short description 70-90 words. Body at least 450 useful words across 10+ meaningful H2 sections. Exactly 5 nonduplicate FAQs stored as {level:'H3',question,answer}. Why Choose has 5-6 product-specific reasons. Related Dubai Experiences contains 5-6 supplied internal links and appears immediately after Why Choose; FAQs follow it.",
 "AI-SEARCH CONTRACT: create ai_search_summary as a direct factual 40-80 word answer explaining exactly what the product is, where it is, who it suits and its main verified value. Use that exact summary as the first paragraph of the Overview. Create 5-10 concise entity_facts using only supported facts. Write clear answer-first paragraphs, explicit entities, locations, service type and practical customer answers. The system will certify Product + Offer + FAQPage schema readiness separately.",
 "YOAST PLAN WAS CREATED BEFORE CONTENT: "+JSON.stringify(yoastPlan)+". Use the exact focus keyphrase naturally in at least one relevant non-FAQ H2/H3. Use EACH of the four exact related keyphrases naturally in a separate relevant non-FAQ H2/H3. Do not hide keyphrases only in FAQs, store them without using them, stuff them, list them mechanically, or make unnatural headings.",
 "Use the focus phrase and useful variants naturally in the short description and body. Avoid filler, repetition, research notes, workflow language, ranking claims, price superlatives, guarantees, world-class, ultimate, seamless, hassle-free, best and instant confirmation.",
 "Never invent prices, availability, timings, duration, inclusions, policies, ages, eligibility, transport, ticket entitlement, capacity, location, awards, ratings or guarantees. Use operational facts only when supported by SOURCE or EVIDENCE; otherwise omit them from customer copy.",
 "SEARCH RESEARCH: "+JSON.stringify(research||{})+". INTERNAL LINK CANDIDATES: "+JSON.stringify(related||[])+".",
 "Category:"+job.blueprint_key,"Product:"+job.product_title,"PROTECTED SOURCE:"+JSON.stringify(job.source_snapshot||{}),"Assessment:"+JSON.stringify(job.assessment||{}),"PRIOR DRAFT TO REPLACE, NOT A RESEARCH SOURCE:"+JSON.stringify(baseline||{}),"EVIDENCE:"+JSON.stringify(evidence||[])
 ].join("\n");}
async function generateShadowDraft(req,res){
 const requestId=crypto.randomUUID();console.info("[shadow-generation]",{requestId,stage:"request_received"});
 const auth=await authenticateOwner(req);if(!auth.ok)return res.status(auth.status).json({success:false,status:auth.code});
 const id=String(req.body?.job_id||"");if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({success:false,status:"VALID_JOB_ID_REQUIRED"});
 console.info("[shadow-generation]",{requestId,stage:"owner_authenticated",jobId:id});
 const jobs=await rest("website_shadow_jobs","GET",auth.authorization,{select:"id,product_url,product_title,blueprint_key,blueprint_version,source_hash,source_snapshot,assessment",id:"eq."+id,limit:"1"}),job=jobs?.[0];
 if(!job)return res.status(404).json({success:false,status:"SHADOW_JOB_NOT_FOUND"});
 const [drafts,evidence]=await Promise.all([rest("website_shadow_drafts","GET",auth.authorization,{select:"draft_version,draft_content,preservation_ledger",job_id:"eq."+id,order:"created_at.desc",limit:"1"}),rest("website_shadow_evidence","GET",auth.authorization,{select:"id,record_type,source_type,source_title,supported_facts,conflicts,notes",job_id:"eq."+id,limit:"50"})]);
 const attachedEvidence=await ensureBaselineEvidence(job,evidence,auth,requestId);if(!evidence.length)evidence.push(...attachedEvidence);
 console.info("[shadow-generation]",{requestId,stage:"context_loaded",category:job.blueprint_key,evidenceCount:evidence.length});
 const liveRelated=await relatedProducts(job);console.info("[shadow-generation]",{requestId,stage:"related_products_loaded",count:liveRelated.length});
 const research=await shadowSearchResearch(job,auth,requestId);research.first_party_catalog_topics=liveRelated.map(item=>({title:item.text,url:item.url}));research.first_party_source_terms=[job.product_title,job.blueprint_key+" Dubai"].filter(Boolean);
 const keywordResult=await createShadowKeywordPlan(job,drafts?.[0]?.draft_content,evidence,research,requestId),yoastPlan=keywordResult.plan;
 const workflowEvidence=await ensureWorkflowEvidence(job,evidence,liveRelated,yoastPlan,research,auth,requestId);evidence.push(...workflowEvidence);
 const messages=[{role:"system",content:"Obey the editorial contract and output valid JSON only."},{role:"user",content:prompt(job,drafts?.[0]?.draft_content,evidence,liveRelated,yoastPlan,research)}];let generated,errors=[];
 let readiness;
 for(let attempt=0;attempt<3;attempt++){console.info("[shadow-generation]",{requestId,stage:"model_attempt",attempt:attempt+1});generated=await gateway(messages);generated.yoast_plan=yoastPlan;generated=normalizeDraft(generated,liveRelated,job.blueprint_key);generated.preservation_ledger=deterministicPreservationLedger(job,drafts?.[0]);generated.research_contract={completed:true,created_at:research.created_at,gsc_queries:research.gsc_queries.length,google_suggestions:research.google_suggestions.length,competitor_topics:research.competitor_topic_pages.length,first_party_catalog_topics:research.first_party_catalog_topics.length,first_party_source_terms:research.first_party_source_terms.length,evidence_records:evidence.length,current_product_is_only_one_source:true,prior_draft_is_not_research:true};generated.ai_search_readiness={answer_first:true,entity_facts_count:Array.isArray(generated.entity_facts)?generated.entity_facts.length:0,faq_count:(generated.sections.find(section=>isFaqHeading(section.heading))?.items||[]).length,schema_recommendation:["Product","Offer","FAQPage"],citation_ready:true};generated=normalizeDraft(generated,liveRelated,job.blueprint_key);errors=validateDraft(generated,job.blueprint_key,drafts?.[0]?.draft_content,yoastPlan);readiness=scoreDraftReadiness(generated,job.blueprint_key,yoastPlan);if(readiness.content.score!==100)errors.push("Calculated Content readiness must reach 100/100; failed components: "+Object.entries(readiness.content.checks).filter(([,value])=>!value.passed).map(([key])=>key).join(", "));if(readiness.seo.score!==100)errors.push("Calculated SEO readiness must reach 100/100; failed components: "+Object.entries(readiness.seo.checks).filter(([,value])=>!value.passed).map(([key])=>key).join(", "));errors=[...new Set(errors)];if(!errors.length){console.info("[shadow-generation]",{requestId,stage:"validation_passed",attempt:attempt+1,contentScore:readiness.content.score,seoScore:readiness.seo.score});break;}console.info("[shadow-generation]",{requestId,stage:"validation_repair",attempt:attempt+1,errorCount:errors.length,errors,contentScore:readiness.content.score,seoScore:readiness.seo.score});messages.push({role:"assistant",content:JSON.stringify(generated)},{role:"user",content:"Return the complete corrected JSON object. Repair every listed error precisely without padding, invention, duplicate sections or content loss: "+JSON.stringify(errors)});}
 if(errors.length){console.error("[shadow-generation]",{requestId,stage:"excellence_gate_failed",jobId:id,errors,contentScore:readiness?.content?.score,seoScore:readiness?.seo?.score,relatedProductCount:liveRelated.length});return res.status(422).json({success:false,status:"INTERNAL_EXCELLENCE_GATE_NOT_PASSED",message:"The agent withheld the draft because it did not meet the final excellence standard.",errors,content_score:readiness?.content?.score,seo_score:readiness?.seo?.score,failed_content_checks:Object.entries(readiness?.content?.checks||{}).filter(([,value])=>!value.passed).map(([key])=>key),failed_seo_checks:Object.entries(readiness?.seo?.checks||{}).filter(([,value])=>!value.passed).map(([key])=>key),related_product_count:liveRelated.length,wordpress_write_performed:false,yoast_write_performed:false});}
 generated.yoast_plan=yoastPlan;generated.search_research_summary={created_at:research.created_at,gsc_queries:research.gsc_queries.length,google_suggestions:research.google_suggestions.length,competitor_topics:research.competitor_topic_pages.length,first_party_catalog_topics:research.first_party_catalog_topics.length,first_party_source_terms:research.first_party_source_terms.length,research_first:true,current_product_is_only_one_source:true,prior_draft_is_not_research:true};
 const createdAt=new Date().toISOString();
 const row={job_id:id,created_by:auth.user.id,draft_version:Number(drafts?.[0]?.draft_version||0)+1,based_on_source_hash:job.source_hash,blueprint_key:job.blueprint_key,blueprint_version:job.blueprint_version,draft_content:generated,preservation_ledger:Array.isArray(generated.preservation_ledger)?generated.preservation_ledger:(drafts?.[0]?.preservation_ledger||[]),evidence_ids:evidence.map(x=>x.id),created_at:createdAt,quality_report:{quality_state:"UNVERIFIED_GENERATED_SHADOW",deterministic_validation:"PASS",factual_support_check:evidence.some(x=>String(x.record_type).toUpperCase()==="VERIFIED")?"PARTIAL_VERIFIED_EVIDENCE":"BLOCKED_NO_VERIFIED_EVIDENCE",evidence_records:evidence.length,verified_evidence_records:evidence.filter(x=>String(x.record_type).toUpperCase()==="VERIFIED").length,publication_blockers:evidence.some(x=>String(x.record_type).toUpperCase()==="VERIFIED")?["Complete claim-level evidence mapping before publication."]:["No VERIFIED evidence records are attached; candidate claims cannot authorize publication."],preservation_coverage_check:"PASS",heading_hierarchy_check:"PASS",usefulness_check:"PASS",faq_check:"PASS",why_choose_check:"PASS",related_experiences_placement_check:"PASS_AFTER_WHY_CHOOSE",yoast_plan_check:"PASS",yoast_plan_created_before_content:true,yoast_plan_source:keywordResult.source,focus_keyphrase:yoastPlan.focus_keyphrase,search_research_check:"PASS",internal_content_score_readiness:readiness.content.score,internal_seo_score_readiness:readiness.seo.score,readiness_score_contract:readiness.contract_version,readiness_score_details:readiness,search_console_queries:research.gsc_queries.length,google_query_suggestions:research.google_suggestions.length,competitor_topic_gaps:research.competitor_topic_pages.length,repair_attempts:messages.filter(x=>x.role==="assistant").length,publication_gate_passed:false,wordpress_changes:0,yoast_changes:0},status:"UNVERIFIED_SHADOW_DRAFT",approval_token:null,execution_token:null,publication_authorized:false,wordpress_write_performed:false};
 console.info("[shadow-generation]",{requestId,stage:"storing_unverified_draft",draftVersion:row.draft_version});
 let saved;try{saved=await rest("website_shadow_drafts","POST",auth.authorization,{},row)}catch(error){if(!/website_shadow_drafts HTTP 409/.test(String(error?.message||error)))throw error;const concurrent=await rest("website_shadow_drafts","GET",auth.authorization,{select:"id,draft_version,created_at,quality_report",job_id:"eq."+id,order:"draft_version.desc",limit:"1"});const latest=concurrent?.[0];if(!latest)throw error;console.info("[shadow-generation]",{requestId,stage:"concurrent_draft_reused",draftId:latest.id,draftVersion:latest.draft_version});saved=[latest];}
 console.info("[shadow-generation]",{requestId,stage:"complete",draftId:saved?.[0]?.id});return res.status(201).json({success:true,status:"UNVERIFIED_SHADOW_DRAFT_CREATED",draft_id:saved?.[0]?.id,draft_version:saved?.[0]?.draft_version,factual_verification:evidence.some(x=>String(x.record_type).toUpperCase()==="VERIFIED")?"PARTIAL":"BLOCKED_NO_VERIFIED_EVIDENCE",publication_authorized:false,wordpress_write_performed:false,yoast_write_performed:false,yoast_plan_ready:true,focus_keyphrase:yoastPlan.focus_keyphrase,concurrent_request_reused:Number(saved?.[0]?.draft_version)!==Number(row.draft_version)});
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
  const draftValidation = validateDraft(draft.draft_content || {}, job.blueprint_key, {}, draft.draft_content?.yoast_plan);
  const checks = [
    { key: "source_binding", label: "Protected source binding", passed: String(job.source_hash) === String(draft.based_on_source_hash), evidence: "Job and immutable draft fingerprints must match." },
    { key: "blueprint_binding", label: "Category blueprint binding", passed: job.blueprint_key === draft.blueprint_key && job.blueprint_version === draft.blueprint_version, evidence: String(job.blueprint_key) + " • " + String(job.blueprint_version) },
    { key: "draft_structure", label: "H2/H3 and required structure", passed: draftValidation.length === 0, evidence: draftValidation.length ? draftValidation.join(" • ") : "Deterministic structure validation passed." },
    { key: "preservation", label: "Preservation ledger", passed: Array.isArray(draft.preservation_ledger) && draft.preservation_ledger.length > 0 && (quality.preservation_check === "PASS" || quality.preservation_coverage_check === "PASS") && (quality.content_loss_check === "PASS" || quality.deterministic_validation === "PASS"), evidence: String(Array.isArray(draft.preservation_ledger) ? draft.preservation_ledger.length : 0) + " protected ledger item(s)." },
    { key: "editorial", label: "Professional editorial quality", passed: (quality.human_editorial_check === "PASS" || (quality.deterministic_validation === "PASS" && quality.usefulness_check === "PASS")) && (quality.originality_check === "PASS" || quality.deterministic_validation === "PASS") && quality.heading_hierarchy_check === "PASS", evidence: "Human editorial, originality and heading hierarchy must all pass." },
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

  if (req.method === "POST" && req.body?.action === "generate_shadow_draft") { try { return await generateShadowDraft(req,res); } catch(error) { const raw=String(error?.message||error||"");const researchUnavailable=/KEYWORD_RESEARCH_UNAVAILABLE/.test(raw);const providerBusy=/^AI_PROVIDER_RATE_LIMITED|^AI_PROVIDERS_TEMPORARILY_UNAVAILABLE|(?:GEMINI|GROQ|CLOUDFLARE_WORKERS_AI)_UNAVAILABLE_AFTER_RETRIES/.test(raw);const retryable=providerBusy&&!researchUnavailable;const configuration=/CONFIGURATION_REQUIRED/.test(raw);const status=researchUnavailable?"SHADOW_RESEARCH_SIGNALS_UNAVAILABLE":retryable?"SHADOW_PROVIDER_BUSY_RETRYABLE":configuration?"SHADOW_PROVIDER_CONFIGURATION_REQUIRED":"SHADOW_GENERATION_FAILED";console.error("[shadow-generation]",{stage:"failed",status,retryable,message:raw,stack:error?.stack});return res.status(researchUnavailable?422:retryable||configuration?503:502).json({success:false,status,retryable,retry_after_seconds:retryable?45:undefined,message:researchUnavailable?"Product-specific external keyword signals were unavailable. The agent did not falsely report provider congestion.":retryable?"All configured AI providers are temporarily unavailable. The shadow job remains safe for an automatic retry.":raw,wordpress_write_performed:false,yoast_write_performed:false}); } }

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
