import { NextRequest, NextResponse } from 'next/server';
import { env } from '../config/env';

// Rate limiting storage (in production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  message?: string;
}

interface SecurityContext {
  userId?: string;
  role?: string;
  ip: string;
  userAgent?: string;
  timestamp: number;
}

export class SecurityMiddleware {
  // Rate limiting
  static rateLimit(config: RateLimitConfig) {
    return async (request: NextRequest) => {
      const ip = request.headers.get('x-forwarded-for') || 
                 request.headers.get('x-real-ip') || 
                 'unknown';
      
      const now = Date.now();
      const windowStart = now - config.windowMs;
      
      // Clean up old entries
      for (const [key, value] of rateLimitStore.entries()) {
        if (value.resetTime < windowStart) {
          rateLimitStore.delete(key);
        }
      }
      
      // Get or create rate limit entry
      const entry = rateLimitStore.get(ip) || { count: 0, resetTime: now + config.windowMs };
      
      if (entry.resetTime < now) {
        entry.count = 0;
        entry.resetTime = now + config.windowMs;
      }
      
      entry.count++;
      rateLimitStore.set(ip, entry);
      
      if (entry.count > config.maxRequests) {
        return NextResponse.json(
          { error: config.message || 'Too many requests' },
          { status: 429, headers: { 'Retry-After': Math.ceil((entry.resetTime - now) / 1000).toString() } }
        );
      }
      
      return NextResponse.next();
    };
  }

  // Input validation
  static validateInput(schema: Record<string, any>) {
    return async (request: NextRequest) => {
      try {
        const body = await request.json();
        
        for (const [field, rules] of Object.entries(schema)) {
          const value = body[field];
          
          if (rules.required && (value === undefined || value === null || value === '')) {
            return NextResponse.json(
              { error: `Field '${field}' is required` },
              { status: 400 }
            );
          }
          
          if (value !== undefined && value !== null) {
            if (rules.type && typeof value !== rules.type) {
              return NextResponse.json(
                { error: `Field '${field}' must be of type ${rules.type}` },
                { status: 400 }
              );
            }
            
            if (rules.min !== undefined && value < rules.min) {
              return NextResponse.json(
                { error: `Field '${field}' must be at least ${rules.min}` },
                { status: 400 }
              );
            }
            
            if (rules.max !== undefined && value > rules.max) {
              return NextResponse.json(
                { error: `Field '${field}' must be at most ${rules.max}` },
                { status: 400 }
              );
            }
            
            if (rules.pattern && !rules.pattern.test(value)) {
              return NextResponse.json(
                { error: `Field '${field}' is invalid` },
                { status: 400 }
              );
            }
            
            if (rules.enum && !rules.enum.includes(value)) {
              return NextResponse.json(
                { error: `Field '${field}' must be one of: ${rules.enum.join(', ')}` },
                { status: 400 }
              );
            }
          }
        }
        
        return NextResponse.next();
      } catch (error) {
        return NextResponse.json(
          { error: 'Invalid JSON input' },
          { status: 400 }
        );
      }
    };
  }

  // Role-based access control
  static requireRole(allowedRoles: string[]) {
    return async (request: NextRequest) => {
      const authHeader = request.headers.get('authorization');
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      
      const token = authHeader.substring(7);
      
      try {
        // Verify JWT token and extract user role
        const user = await this.verifyToken(token);
        
        if (!user || !allowedRoles.includes(user.role)) {
          return NextResponse.json(
            { error: 'Forbidden: Insufficient permissions' },
            { status: 403 }
          );
        }
        
        // Add user context to request headers
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set('x-user-id', user.id);
        requestHeaders.set('x-user-role', user.role);
        
        return NextResponse.next({
          request: { headers: requestHeaders }
        });
      } catch (error) {
        return NextResponse.json(
          { error: 'Invalid token' },
          { status: 401 }
        );
      }
    };
  }

  // JWT verification
  static async verifyToken(token: string): Promise<{ id: string; role: string } | null> {
    try {
      // In production, use proper JWT verification with crypto
      // For now, this is a placeholder
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }
      
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      
      // Check token expiration
      if (payload.exp && payload.exp < Date.now() / 1000) {
        return null;
      }
      
      return {
        id: payload.sub || payload.user_id,
        role: payload.role || 'citizen',
      };
    } catch (error) {
      return null;
    }
  }

  // Sanitize input to prevent XSS
  static sanitizeInput(input: any): any {
    if (typeof input === 'string') {
      return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    }
    
    if (Array.isArray(input)) {
      return input.map(item => this.sanitizeInput(item));
    }
    
    if (typeof input === 'object' && input !== null) {
      const sanitized: any = {};
      for (const key in input) {
        if (input.hasOwnProperty(key)) {
          sanitized[key] = this.sanitizeInput(input[key]);
        }
      }
      return sanitized;
    }
    
    return input;
  }

  // SQL injection prevention
  static sanitizeSqlInput(input: string): string {
    return input
      .replace(/'/g, "''")
      .replace(/;/g, '')
      .replace(/--/g, '')
      .replace(/\/\*/g, '')
      .replace(/\*\//g, '')
      .replace(/xp_/gi, '')
      .replace(/exec/gi, '');
  }

  // Extract security context from request
  static extractSecurityContext(request: NextRequest): SecurityContext {
    return {
      userId: request.headers.get('x-user-id') || undefined,
      role: request.headers.get('x-user-role') || undefined,
      ip: request.headers.get('x-forwarded-for') || 
           request.headers.get('x-real-ip') || 
           'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      timestamp: Date.now(),
    };
  }

  // Log security events
  static async logSecurityEvent(
    context: SecurityContext,
    event: string,
    details?: any
  ): Promise<void> {
    // In production, this would log to a security monitoring system
    console.log('[SECURITY]', {
      event,
      context,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  // Validate table names to prevent SQL injection
  static validateTableName(tableName: string): boolean {
    const validTables = [
      'users', 'vehicles', 'taxi_stations', 'bus_terminals', 'routes',
      'trips', 'tickets', 'hotels', 'hotel_bookings', 'hospitals',
      'pharmacies', 'tourism_sites', 'tour_packages', 'emergency_requests',
      'emergency_centers', 'announcements', 'notifications', 'payments',
      'wallet_transactions', 'government_offices', 'churches',
      'eco_shine_locations', 'marketplace_providers', 'guest_houses',
      'analytics', 'audit_logs', 'driver_profiles', 'station_queues',
      'revenue_tracking', 'system_config', 'refund_requests',
      'support_tickets', 'promotions', 'user_promotions',
      'location_history',
    ];
    
    return validTables.includes(tableName) && /^[a-z_]+$/.test(tableName);
  }

  // Validate file uploads
  static validateFileUpload(file: File, allowedTypes: string[], maxSize: number): boolean {
    if (!allowedTypes.includes(file.type)) {
      return false;
    }
    
    if (file.size > maxSize) {
      return false;
    }
    
    return true;
  }

  // CORS headers
  static corsHeaders(allowedOrigins: string[]) {
    return {
      'Access-Control-Allow-Origin': allowedOrigins.join(', '),
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };
  }

  // Security headers
  static securityHeaders() {
    return {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'self'",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
  }
}

// Pre-defined rate limit configurations
export const rateLimitConfigs = {
  strict: { windowMs: 60000, maxRequests: 10 }, // 10 requests per minute
  moderate: { windowMs: 60000, maxRequests: 30 }, // 30 requests per minute
  lenient: { windowMs: 60000, maxRequests: 100 }, // 100 requests per minute
  api: { windowMs: 60000, maxRequests: 60 }, // 60 requests per minute
  auth: { windowMs: 900000, maxRequests: 5 }, // 5 requests per 15 minutes
};

// Pre-defined validation schemas
export const validationSchemas = {
  user: {
    email: { required: true, type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    full_name: { required: true, type: 'string', min: 2, max: 255 },
    phone: { required: false, type: 'string', pattern: /^\+?[0-9]{10,15}$/ },
    role: { required: true, type: 'string', enum: ['citizen', 'superAdmin', 'taxiAdmin', 'tourismAdmin', 'hotelAdmin', 'healthAdmin', 'pharmacyAdmin', 'emergencyAdmin', 'churchAdmin', 'businessAdmin', 'governmentFleetAdmin', 'taxiDriver', 'oldTerminalAdmin', 'newTerminalAdmin'] },
  },
  payment: {
    amount: { required: true, type: 'number', min: 0.01, max: 1000000 },
    currency: { required: true, type: 'string', enum: ['ETB', 'USD'] },
    method: { required: true, type: 'string', enum: ['telebirr', 'cbe_birr', 'chapa', 'santimpay', 'cash', 'wallet'] },
  },
  trip: {
    vehicle_id: { required: true, type: 'string' },
    passenger_id: { required: true, type: 'string' },
    start_location: { required: true, type: 'object' },
    end_location: { required: true, type: 'object' },
    fare: { required: true, type: 'number', min: 0 },
  },
};