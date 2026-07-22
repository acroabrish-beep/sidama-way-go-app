import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '@/lib/supabase/client';
import { env } from '@/lib/config/env';

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(env.geminiApiKey);

// Conversation memory
const conversationMemory = new Map<string, Array<{role: string, content: string, timestamp: number}>>();

const MAX_MEMORY_SIZE = 20;
const MEMORY_TTL = 30 * 60 * 1000; // 30 minutes

interface AIContext {
  language: string;
  location?: any;
  role?: string;
  userId?: string;
}

interface CityData {
  taxiStations: any[];
  announcements: any[];
  hotels: any[];
  hospitals: any[];
  tourismSites: any[];
  emergencyCenters: any[];
  vehicles: any[];
  trips: any[];
  analytics: any[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      message, 
      history = [], 
      language = 'en', 
      location, 
      role,
      userId,
      sessionId 
    } = body;

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Get user conversation memory
    const userMemory = conversationMemory.get(sessionId || 'default') || [];
    
    // Clean up old memory
    const now = Date.now();
    const cleanMemory = userMemory.filter(
      (item) => now - item.timestamp < MEMORY_TTL
    ).slice(-MAX_MEMORY_SIZE);
    
    conversationMemory.set(sessionId || 'default', cleanMemory);

    // Get real-time city data
    const cityData = await getComprehensiveCityData();

    // Build enhanced system prompt with live data
    const systemPrompt = buildEnhancedSystemPrompt(
      language, 
      cityData, 
      location, 
      role,
      userId
    );

    // Combine history with memory
    const combinedHistory = [
      ...cleanMemory.map(item => ({
        role: item.role,
        parts: [{ text: item.content }]
      })),
      ...history.slice(-10).map((msg: any) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content || msg.text || '' }]
      }))
    ];

    // Initialize the model with system instruction
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      systemInstruction: Content.system(systemPrompt),
    });

    // Start chat session
    const chatSession = model.startChat({ history: combinedHistory });
    
    // Send message and get response
    const result = await chatSession.sendMessage(Content.text(message));
    const response = result.response;

    if (!response.text()) {
      throw new Error('Empty response from Gemini');
    }

    // Update memory
    cleanMemory.push({
      role: 'user',
      content: message,
      timestamp: now
    });
    cleanMemory.push({
      role: 'model',
      content: response.text!,
      timestamp: now
    });
    conversationMemory.set(sessionId || 'default', cleanMemory);

    return NextResponse.json({
      response: response.text,
      timestamp: new Date().toISOString(),
      context: {
        cityDataSummary: {
          taxiStations: cityData.taxiStations.length,
          announcements: cityData.announcements.length,
          activeVehicles: cityData.vehicles.filter((v: any) => v.status === 'online').length,
          ongoingTrips: cityData.trips.filter((t: any) => t.status === 'ongoing').length,
        }
      }
    });

  } catch (error) {
    console.error('Gemini API Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process AI request',
        fallback: getFallbackResponse(message, language),
      },
      { status: 500 }
    );
  }
}

async function getComprehensiveCityData(): Promise<CityData> {
  try {
    const [
      stationsResult,
      announcementsResult,
      hotelsResult,
      hospitalsResult,
      tourismResult,
      emergencyResult,
      vehiclesResult,
      tripsResult,
      analyticsResult,
    ] = await Promise.all([
      supabase.from('taxi_stations').select('*').eq('status', 'active').limit(10),
      supabase.from('announcements').select('*').eq('is_active', true).limit(5),
      supabase.from('hotels').select('*').eq('status', 'active').limit(5),
      supabase.from('hospitals').select('*').eq('status', 'active').limit(5),
      supabase.from('tourism_sites').select('*').eq('status', 'active').limit(8),
      supabase.from('emergency_centers').select('*').eq('status', 'active').limit(5),
      supabase.from('vehicles').select('*').in('status', ['online', 'busy']).limit(20),
      supabase.from('trips').select('*').in('status', ['pending', 'ongoing']).limit(10),
      supabase.from('analytics').select('*').order('timestamp', { ascending: false }).limit(10),
    ]);

    return {
      taxiStations: stationsResult.data || [],
      announcements: announcementsResult.data || [],
      hotels: hotelsResult.data || [],
      hospitals: hospitalsResult.data || [],
      tourismSites: tourismResult.data || [],
      emergencyCenters: emergencyResult.data || [],
      vehicles: vehiclesResult.data || [],
      trips: tripsResult.data || [],
      analytics: analyticsResult.data || [],
    };
  } catch (error) {
    console.error('Error fetching city data:', error);
    return {
      taxiStations: [],
      announcements: [],
      hotels: [],
      hospitals: [],
      tourismSites: [],
      emergencyCenters: [],
      vehicles: [],
      trips: [],
      analytics: [],
    };
  }
}

function buildEnhancedSystemPrompt(
  language: string, 
  cityData: CityData, 
  location?: any, 
  role?: string,
  userId?: string
): string {
  const taxiStations = cityData.taxiStations
    .map((s: any) => `${s.name}: ${s.online_taxi_count || 0} taxis, ${s.waiting_passengers || 0} waiting`)
    .join(', ');

  const announcements = cityData.announcements
    .map((a: any) => `[${a.priority}] ${a.title}`)
    .join(', ');

  const hotels = cityData.hotels
    .map((h: any) => `${h.name} (${h.star_rating}★, ${h.price_range})`)
    .join(', ');

  const hospitals = cityData.hospitals
    .map((h: any) => `${h.name} (${h.type}) - ${h.beds_available || 0} beds available`)
    .join(', ');

  const tourismSites = cityData.tourismSites
    .map((t: any) => `${t.name} (${t.category}) - ${t.entrance_fee || 'Free'}`)
    .join(', ');

  const emergencyCenters = cityData.emergencyCenters
    .map((e: any) => `${e.name} (${e.type})`)
    .join(', ');

  const activeVehicles = cityData.vehicles.length;
  const ongoingTrips = cityData.trips.length;

  const locationInfo = location 
    ? `Current Location: ${JSON.stringify(location)}` 
    : 'Location: Not provided';
  
  const roleInfo = role 
    ? `User Role: ${role}` 
    : 'User Role: Citizen';
  
  const userIdInfo = userId 
    ? `User ID: ${userId}` 
    : '';

  const languageInstruction = language === 'am' 
    ? 'Respond ONLY in Amharic (አማርኛ).' 
    : language === 'sid' 
    ? 'Respond ONLY in Sidaamu Afoo.' 
    : 'Respond in English.';

  // Get latest analytics
  const latestAnalytics = cityData.analytics[0];
  const analyticsInfo = latestAnalytics 
    ? `Latest Analytics: ${JSON.stringify(latestAnalytics.metric_value)}` 
    : 'No recent analytics data';

  return `
You are the official AI assistant for Sidama Way Go - the Smart Hawassa City Platform.
You help citizens and tourists with real-time city information and services.

REAL-TIME CITY CONTEXT:
- Active Taxi Stations: ${taxiStations}
- Recent Announcements: ${announcements}
- Available Hotels: ${hotels}
- Healthcare Centers: ${hospitals}
- Top Tourist Sites: ${tourismSites}
- Emergency Support Centers: ${emergencyCenters}
- Active Vehicles: ${activeVehicles}
- Ongoing Trips: ${ongoingTrips}
- ${analyticsInfo}

USER CONTEXT:
- ${locationInfo}
- ${roleInfo}
- ${userIdInfo}

CITY INFORMATION:
- Hawassa is the capital of Sidama Region, Ethiopia.
- Famous for Lake Hawassa, Amora Gedel, and Tabor Mountain.
- Fichee-Chambalaala is the UNESCO-registered Sidama New Year.
- Coordinates: 7°03′N 38°28′E
- Population: ~400,000 (2024 estimate)

AVAILABLE SERVICES:
- Transportation: Taxi, Bajaj, Bus, Intercity
- Emergency: Medical, Police, Fire, Accident
- Tourism: Hotels, Tour Packages, Tour Guides
- Healthcare: Hospitals, Pharmacies
- Government: Services, Offices, Fleet
- Payments: Telebirr, CBE Birr, Chapa, SantimPay, Wallet

INSTRUCTIONS:
1. Provide accurate information based on the real-time city context provided above.
2. If the user asks for something not in context, use your general knowledge about Hawassa and Ethiopia.
3. For transport queries, use current vehicle and station data.
4. For emergency situations, prioritize providing emergency contact information and nearest centers.
5. For tourism, provide information about sites, hotels, and packages.
6. For payments, explain available payment methods (Telebirr, CBE Birr, Chapa, SantimPay, Wallet, Cash).
7. Keep responses concise but comprehensive.
8. ${languageInstruction}
9. Be respectful and culturally appropriate.
10. If you don't know something specific, admit it and suggest contacting the relevant service.
11. For technical issues, suggest contacting support.

SPECIALIZED KNOWLEDGE:
- Transport: Use real-time vehicle counts and trip status
- Emergency: Prioritize based on severity and availability
- Tourism: Provide practical information about sites and services
- Healthcare: Include both hospitals and pharmacies
- Government: Explain available services and procedures

Remember: You are representing the official Sidama Way Go CityOS platform.
`;
}

function getFallbackResponse(query: string, lang: string) {
  const q = query.toLowerCase();
  
  let info = "I'm currently unable to access real-time city data. ";
  
  if (q.includes('emergency') || q.includes('አድጊ')) {
    info += "For emergencies, call 911 or visit the nearest emergency center.";
  } else if (q.includes('taxi') || q.includes('ታክሲ')) {
    info += "Taxi services are available at designated stations throughout the city.";
  } else if (q.includes('hotel') || q.includes('ሆቴል')) {
    info += "Hotels are available in various price ranges across the city.";
  } else if (q.includes('hospital') || q.includes('ሆስፓል')) {
    info += "Healthcare facilities are available 24/7 for emergencies.";
  } else {
    info += "Please try again later or contact support.";
  }

  const prefix = lang === 'am'
    ? "ይቅርታ፣ የ AI አገልግሎት ለጊዜው አልተገኘም። "
    : "I apologize, but the AI service is temporarily unavailable. ";

  return prefix + info;
}