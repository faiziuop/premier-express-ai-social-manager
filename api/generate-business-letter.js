const SUPABASE_URL = "https://ivtwkyfiagouazopttlc.supabase.co";
const SUPABASE_KEY = "sb_publishable_w2Cn5cENECQqUUY3lAXH0w_GlSLz5iW";
const OWNER_USER_ID = "a3a56856-7613-48a6-898c-1526a76f8ee7";
const MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash"];

async function authenticate(req) {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, authorization } });
  if (!response.ok) return false;
  const user = await response.json();
  return user.id === OWNER_USER_ID;
}

async function generateWithGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("AI generation is not configured");
  let lastError = "AI provider unavailable";
  for (const model of MODELS) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8000, responseMimeType: "application/json" }
        }),
        signal: AbortSignal.timeout(55000)
      });
      const raw = await response.text();
      if (!response.ok) { lastError = `AI provider returned HTTP ${response.status}`; continue; }
      const api = JSON.parse(raw);
      const text = api?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
      return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    } catch (error) { lastError = error?.message || String(error); }
  }
  throw new Error(lastError);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ success: false, error: "Method not allowed" }); }
  if (!(await authenticate(req))) return res.status(401).json({ success: false, error: "Authenticated owner access required" });
  try {
    const purpose = String(req.body?.purpose || "").trim().slice(0, 12000);
    const letterDate = String(req.body?.letter_date || "").trim().slice(0, 20);
    const reference = String(req.body?.reference_number || "").trim().slice(0, 80);
    if (purpose.length < 10) return res.status(400).json({ success: false, error: "Please provide a more complete letter purpose." });
    const prompt = `You are the senior corporate correspondence writer for PREMIER EXPRESS TOURISM LLC, Dubai, UAE. Prepare a polished, issue-ready professional business letter from the instructions below.\n\nUSER INSTRUCTIONS:\n${purpose}\n\nDOCUMENT DATE: ${letterDate || "not supplied"}\nREFERENCE: ${reference || "not supplied"}\n\nRULES:\n- Select the correct convention for an ordinary business letter, request, confirmation, authorization, NOC, undertaking, agreement, or other requested document.\n- Use only facts explicitly supplied. Never invent names, titles, identification or vehicle numbers, amounts, dates, addresses, permissions, promises, legal clauses, or government requirements.\n- The subject must contain only the letter type or purpose. Never include any person's name in the subject.\n- When recipient details are absent, use \"To Whom It May Concern\" for recipient_name, empty strings for other recipient fields, and \"Dear Sir/Madam,\" as salutation.\n- Do not repeat the date, address block, subject, salutation, closing, signature, letterhead, footer, certificate validity, or alteration warning in body_paragraphs.\n- Write substantive, specific, courteous formal international business English. Avoid vague filler.\n- A NOC must clearly state the purpose and limits supported by the input. An agreement must use numbered clauses but add no unsupplied commercial or legal terms.\n- Preserve supplied spelling. Keep signatory_name empty unless supplied; signatory_title may be \"Authorized Signatory\".\n- Return JSON only with exactly these keys: document_type, recipient_name, recipient_title, recipient_company, recipient_address, subject, salutation, body_paragraphs (array of strings), closing, signatory_name, signatory_title.`;
    const letter = await generateWithGemini(prompt);
    if (!letter?.subject || !Array.isArray(letter.body_paragraphs) || !letter.body_paragraphs.length) throw new Error("The AI returned an incomplete draft. Add more detail and try again.");
    return res.status(200).json({ success: true, letter });
  } catch (error) {
    console.error("[business-letter]", error);
    return res.status(502).json({ success: false, error: "The AI could not generate the letter right now. Please try again." });
  }
}
