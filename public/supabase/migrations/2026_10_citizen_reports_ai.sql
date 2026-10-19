-- Migration: Add AI triage fields to citizen_reports table
-- This migration is safe to run multiple times (uses IF NOT EXISTS)

-- AI status tracking
ALTER TABLE citizen_reports
ADD COLUMN IF NOT EXISTS ai_status text NOT NULL DEFAULT 'pending'
CHECK (ai_status IN ('pending', 'done', 'failed', 'skipped'));

-- AI-suggested category (same allowed values as category column)
ALTER TABLE citizen_reports
ADD COLUMN IF NOT EXISTS ai_category text
CHECK (ai_category IN ('pothole', 'garbage', 'street_light', 'water', 'other'));

-- AI-suggested urgency level
ALTER TABLE citizen_reports
ADD COLUMN IF NOT EXISTS ai_urgency text
CHECK (ai_urgency IN ('low', 'medium', 'high'));

-- AI-generated summary (one sentence, English)
ALTER TABLE citizen_reports
ADD COLUMN IF NOT EXISTS ai_summary text;

-- Detected language of the report
ALTER TABLE citizen_reports
ADD COLUMN IF NOT EXISTS ai_language text;

-- AI confidence score (0 to 1)
ALTER TABLE citizen_reports
ADD COLUMN IF NOT EXISTS ai_confidence numeric
CHECK (ai_confidence >= 0 AND ai_confidence <= 1);

-- AI model used for triage
ALTER TABLE citizen_reports
ADD COLUMN IF NOT EXISTS ai_model text;

-- Timestamp when AI triage completed
ALTER TABLE citizen_reports
ADD COLUMN IF NOT EXISTS triaged_at timestamptz;

-- Timestamp when report was assigned to a worker/admin
ALTER TABLE citizen_reports
ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

-- Timestamp when report was resolved
ALTER TABLE citizen_reports
ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- Final category set by admin (overrides AI suggestion)
ALTER TABLE citizen_reports
ADD COLUMN IF NOT EXISTS final_category text
CHECK (final_category IN ('pothole', 'garbage', 'street_light', 'water', 'other'));

-- Final urgency set by admin (overrides AI suggestion)
ALTER TABLE citizen_reports
ADD COLUMN IF NOT EXISTS final_urgency text
CHECK (final_urgency IN ('low', 'medium', 'high'));

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
