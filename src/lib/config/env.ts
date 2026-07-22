export const env = {
  // Supabase Configuration
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // Google Gemini AI Configuration
  geminiApiKey: process.env.GEMINI_API_KEY || '',

  // Firebase Configuration
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',

  // Google Maps Configuration
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',

  // Payment Provider Configuration
  telebirrApiKey: process.env.TELEBIRR_API_KEY || '',
  telebirrSecretKey: process.env.TELEBIRR_SECRET_KEY || '',
  chapaPublicKey: process.env.CHAPA_PUBLIC_KEY || '',
  chapaSecretKey: process.env.CHAPA_SECRET_KEY || '',
  santimpayApiKey: process.env.SANTIMPAY_API_KEY || '',
  santimpaySecretKey: process.env.SANTIMPAY_SECRET_KEY || '',

  // Environment
  nodeEnv: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV !== 'production',
  isProduction: process.env.NODE_ENV === 'production',
};

export function validateEnv() {
  const required = [
    'supabaseUrl',
    'supabaseAnonKey',
    'geminiApiKey',
    'firebaseProjectId',
  ];

  const missing = required.filter(key => !env[key as keyof typeof env]);

  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing);
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  console.log('Environment configuration validated successfully');
}