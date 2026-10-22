import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '@/lib/supabase/client';
import { env } from '@/lib/config/env';
import { requireCallerWithEnforce } from '@/lib/auth/verify';

// Initialize Gemini AI lazily so a missing key produces an honest 503
// instead of crashing the route module at import time.
let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI | null {
  if (!env.geminiApiKey) return null;
  if (!genAI) {
    genAI = new GoogleGenerativeAI(env.geminiApiKey);
  }
  return genAI;
}

export async function POST(request: NextRequest) {
  // Auth check: any valid caller
  const authResult = await requireCallerWithEnforce(request, {
    route: '/api/gemini',
    method: 'POST',
  });

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.status }
    );
  }

  const gemini = getGenAI();
  if (!gemini) {
    return NextResponse.json(
      { error: 'AI service is not configured (GEMINI_API_KEY is missing).' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { message, history = [], language = 'en', location, role } = body;

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Get real-time city context from Supabase
    const cityContext = await getCityContext();

    // Build system prompt with real-time data
    const systemPrompt = buildSystemPrompt(language, cityContext, location, role);

    // Convert history to Gemini format
    const chatHistory = history.slice(-20).map((msg: any) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content || msg.text || '' }],
    }));

    // Initialize the model with system instruction
    const model = gemini.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      systemInstruction: systemPrompt,
    });

    // Start chat session
    const chatSession = model.startChat({ history: chatHistory });

    // Send message and get response
    const result = await chatSession.sendMessage(message);
    const response = result.response;

    if (!response.text()) {
      throw new Error('Empty response from Gemini');
    }

    return NextResponse.json({
      response: response.text(),
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Gemini API Error:', error);
    return NextResponse.json(
      { error: 'Failed to process AI request. Please try again later.' },
      { status: 500 }
    );
  }
}

async function getCityContext() {
  try {
    const [
      stationsResult,
      announcementsResult,
      hotelsResult,
      hospitalsResult,
      tourismResult,
      emergencyResult,
    ] = await Promise.all([
      supabase.from('taxi_stations').select('name, online_taxi_count').eq('status', 'active').limit(5),
      supabase.from('announcements').select('title').eq('is_active', true).limit(3),
      supabase.from('hotels').select('name').eq('status', 'active').limit(3),
      supabase.from('hospitals').select('name').eq('status', 'active').limit(3),
      supabase.from('tourism_sites').select('name').eq('status', 'active').limit(5),
      supabase.from('emergency_centers').select('name, type').eq('status', 'active').limit(3),
    ]);

    return {
      taxiStations: stationsResult.data?.map(s => `${s.name}: ${s.online_taxi_count} taxis`).join(', ') || 'No active stations',
      announcements: announcementsResult.data?.map(a => a.title).join(', ') || 'No recent announcements',
      hotels: hotelsResult.data?.map(h => h.name).join(', ') || 'No hotels available',
      hospitals: hospitalsResult.data?.map(h => h.name).join(', ') || 'No hospitals available',
      tourismSites: tourismResult.data?.map(t => t.name).join(', ') || 'No tourism sites',
      emergencyCenters: emergencyResult.data?.map(e => `${e.name} (${e.type})`).join(', ') || 'No emergency centers',
    };
  } catch (error) {
    console.error('Error fetching city context:', error);
    return null;
  }
}

function buildSystemPrompt(language: string, cityContext: any, location?: any, role?: string) {
  const context = cityContext || {
    taxiStations: 'No data available',
    announcements: 'No data available',
    hotels: 'No data available',
    hospitals: 'No data available',
    tourismSites: 'No data available',
    emergencyCenters: 'No data available',
  };

  const locationInfo = location ? `Current Location: ${JSON.stringify(location)}` : 'Location: Not provided';
  const roleInfo = role ? `User Role: ${role}` : 'User Role: Citizen';

  const languageInstruction = language === 'am' 
    ? 'Respond ONLY in Amharic (አማርኛ).' 
    : language === 'sid' 
    ? 'Respond ONLY in Sidaamu Afoo.' 
    : 'Respond in English.';

  return `
You are the official AI assistant for Sidama Way Go - the Smart Hawassa City Platform.
You help citizens and tourists with real-time city information.

REAL-TIME CITY CONTEXT:
- Active Taxi Stations: ${context.taxiStations}
- Recent Announcements: ${context.announcements}
- Available Hotels: ${context.hotels}
- Healthcare Centers: ${context.hospitals}
- Top Tourist Sites: ${context.tourismSites}
- Emergency Support Centers: ${context.emergencyCenters}

USER CONTEXT:
- ${locationInfo}
- ${roleInfo}

ABOUT HAWASSA:
- Hawassa is the capital of Sidama Region, Ethiopia.
- Famous for Lake Hawassa, Amora Gedel, and Tabor Mountain.
- Fichee-Chambalaala is the UNESCO-registered Sidama New Year.

INSTRUCTIONS:
1. Provide accurate information based on the city context provided above.
2. If the user asks for something not in context, use your general knowledge about Hawassa, but mention you're not seeing live updates for that specific query.
3. Keep responses concise and helpful.
4. ${languageInstruction}
5. Be respectful and culturally appropriate.
6. For emergency situations, prioritize providing emergency contact information.
`;
}

// (fallback removed: the client displays the backend error honestly)