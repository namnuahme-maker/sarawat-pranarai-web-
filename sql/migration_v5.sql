-- ==============================================================
-- SARAWAT OS v5.0 Database Migration Script
-- โรงเรียนพระนารายณ์ (SARAWAT-PRANARAI)
-- ==============================================================

-- 1. เพิ่มฟิลด์ทักษะพิเศษและบัตรประจำตัวในตาราง members
ALTER TABLE public.members 
ADD COLUMN IF NOT EXISTS special_skills TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS custom_skill TEXT,
ADD COLUMN IF NOT EXISTS card_image_url TEXT;

-- 2. ตารางการตั้งค่าระบบ (เช่น แม่แบบบัตร Blueprint, SLA เวลา)
CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- กำหนดค่าเริ่มต้นสำหรับ Blueprint แม่แบบบัตร
INSERT INTO public.system_settings (key, value)
VALUES (
  'card_blueprint',
  '{"template_url": "https://raw.githubusercontent.com/SARAWAT-PRANARAI/assets/main/card_template.png", "version": 1}'
)
ON CONFLICT (key) DO NOTHING;

-- 3. ตารางคำสั่งขอตรวจค้นฉุกเฉินและคู่ตรวจ (Emergency Warrants & Buddy System)
CREATE TABLE IF NOT EXISTS public.emergency_warrants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id TEXT,
  requester_discord_id TEXT NOT NULL,
  buddy_discord_id TEXT,
  location TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING', -- PENDING, APPROVED_LEADER, APPROVED_AI, REJECTED
  approved_by TEXT,
  directive_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- 4. ตารางบันทึกการปฏิบัติหน้าที่และสถิติการเช็คชื่อผ่านกล้อง AI
CREATE TABLE IF NOT EXISTS public.duty_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duty_day TEXT NOT NULL,
  week_no INT,
  member_id UUID REFERENCES public.members(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- PRESENT, LATE, EXCUSED, ABSENT
  scanned_image_url TEXT,
  teacher_signature_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
