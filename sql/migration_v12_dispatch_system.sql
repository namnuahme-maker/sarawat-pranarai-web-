-- =========================================================================
-- MIGRATION V12: TACTICAL DISPATCH & AI VOICE ALERT SYSTEM
-- Table: public.dispatch_logs
-- Purpose: Records executive broadcasts, voice-to-text transcripts,
--          Gemini AI tactical polishing drafts, and real-time Discord
--          acknowledgment lists by verified SARAWAT officers.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.dispatch_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_discord_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_role TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('PATROL', 'INVESTIGATION', 'ASSEMBLY', 'ANNOUNCEMENT')),
    mention_target TEXT NOT NULL DEFAULT 'none',
    original_text TEXT NOT NULL,
    ai_text TEXT,
    selected_version TEXT NOT NULL CHECK (selected_version IN ('original', 'ai')),
    final_text TEXT NOT NULL,
    discord_message_id TEXT,
    discord_channel_id TEXT,
    acknowledged_officers JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for chronological order retrieval in web modal history tab
CREATE INDEX IF NOT EXISTS idx_dispatch_logs_created_at ON public.dispatch_logs(created_at DESC);

-- Index for searching sender activity
CREATE INDEX IF NOT EXISTS idx_dispatch_logs_sender ON public.dispatch_logs(sender_discord_id);
