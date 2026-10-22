import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '@/lib/config/env';

// Initialize Gemini AI lazily so a missing key does not crash the module.
let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI | null {
  if (!env.geminiApiKey) return null;
  if (!genAI) {
    genAI = new GoogleGenerativeAI(env.geminiApiKey);
  }
  return genAI;
}

const MODEL_NAME = 'gemini-1.5-flash';
const TIMEOUT_MS = 10000; // 10 seconds

const ALLOWED_CATEGORIES = ['pothole', 'garbage', 'street_light', 'water', 'other'] as const;
const ALLOWED_URGENCY = ['low', 'medium', 'high'] as const;
const MAX_SUMMARY_LENGTH = 200;

export interface TriageResult {
  category: string;
  urgency: string;
  summary: string;
  language: string;
  confidence: number;
}

export interface TriageInput {
  description: string;
  category: string;
}

/**
 * Redact personal data from text before sending to AI
 * Removes: phone numbers, email addresses, long digit sequences
 */
function redactPersonalData(text: string): string {
  let redacted = text;
  
  // Phone numbers (Ethiopian format: +251..., 09..., 0911..., etc.)
  redacted = redacted.replace(/\+?251\d{9}/g, '[PHONE]');
  redacted = redacted.replace(/09\d{8}/g, '[PHONE]');
  redacted = redacted.replace(/09\d{2}\s?\d{3}\s?\d{3}/g, '[PHONE]');
  
  // Email addresses
  redacted = redacted.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
  
  // Long digit sequences (could be IDs, account numbers, etc.)
  redacted = redacted.replace(/\d{10,}/g, '[ID]');
  
  return redacted;
}

/**
 * Validate the AI response strictly
 */
function validateTriageResponse(data: any): TriageResult | null {
  if (!data || typeof data !== 'object') return null;
  
  // Validate category
  const category = data.category?.toLowerCase();
  if (!ALLOWED_CATEGORIES.includes(category as any)) return null;
  
  // Validate urgency
  const urgency = data.urgency?.toLowerCase();
  if (!ALLOWED_URGENCY.includes(urgency as any)) return null;
  
  // Validate confidence
  const confidence = parseFloat(data.confidence);
  if (isNaN(confidence) || confidence < 0 || confidence > 1) return null;
  
  // Validate summary
  const summary = data.summary?.trim();
  if (!summary || typeof summary !== 'string' || summary.length > MAX_SUMMARY_LENGTH) return null;
  
  // Validate language
  const language = data.language?.trim() || 'other';
  if (typeof language !== 'string') return null;
  
  return {
    category,
    urgency,
    summary,
    language,
    confidence,
  };
}

/**
 * Triage a citizen report using AI
 * Returns null on any failure (missing key, timeout, invalid response)
 */
export async function triageReport(input: TriageInput): Promise<TriageResult | null> {
  // Check if API key is configured
  const client = getGenAI();
  if (!client) {
    console.log('[triage] GEMINI_API_KEY not configured, skipping AI triage');
    return null;
  }
  
  try {
    const { description, category } = input;
    
    // Redact personal data
    const redactedDescription = redactPersonalData(description);
    const redactedCategory = redactPersonalData(category);
    
    console.log('[triage] Processing report with AI');
    
    // System prompt
    const systemPrompt = `You are a city infrastructure triage assistant for Hawassa, Ethiopia.
Your task is to categorize citizen reports and assess urgency.

IMPORTANT RULES:
1. The text may be in Amharic (አማርኛ), Sidaamu Afoo, or English.
2. If you are unsure about the language or content, lower your confidence score.
3. Urgency "high" ONLY for immediate danger to people: open manhole, live electrical wire, flooding, fire, collapsed structure.
4. Urgency "medium" for issues that affect many people or will worsen quickly: large pothole, blocked road, broken water main.
5. Urgency "low" for minor issues: small pothole, overflowing bin, broken street light.
6. Respond ONLY with valid JSON in this exact format:
{
  "category": "pothole|garbage|street_light|water|other",
  "urgency": "low|medium|high",
  "summary": "one sentence summary in English, max 200 chars",
  "language": "am|en|sid|other",
  "confidence": 0.0 to 1.0
}

Allowed categories: pothole, garbage, street_light, water, other
Allowed urgency: low, medium, high
Language codes: am (Amharic), en (English), sid (Sidaamu Afoo), other`;

    // User prompt
    const userPrompt = `Category: ${redactedCategory}\nDescription: ${redactedDescription}\n\nProvide JSON triage result.`;

    // Initialize model with system instruction
    const model = client.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: systemPrompt,
    });

    // Generate response with timeout
    const result = await Promise.race([
      model.generateContent(userPrompt),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('AI triage timeout')), TIMEOUT_MS)
      ),
    ]);

    const response = result.response;
    const text = response.text();
    
    if (!text) {
      console.error('[triage] Empty response from AI');
      return null;
    }

    console.log('[triage] AI response received, parsing JSON');
    
    // Extract JSON from response (in case there's extra text)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[triage] No JSON found in AI response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const validated = validateTriageResponse(parsed);
    
    if (!validated) {
      console.error('[triage] Invalid AI response structure:', parsed);
      return null;
    }

    console.log('[triage] Triage successful:', {
      category: validated.category,
      urgency: validated.urgency,
      language: validated.language,
      confidence: validated.confidence,
    });

    return validated;
    
  } catch (error) {
    console.error('[triage] AI triage failed:', error);
    return null;
  }
}
