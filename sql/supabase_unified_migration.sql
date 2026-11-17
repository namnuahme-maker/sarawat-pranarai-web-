-- =========================================================================
-- 🛡️ SARAWAT UNIFIED DATABASE MIGRATION (v10 Leadership + v11 Thursday Code)
-- รันไฟล์นี้ใน Supabase SQL Editor ได้ในครั้งเดียว (Idempotent & Safe)
-- =========================================================================

BEGIN;

-- 1. สร้างตาราง shift_leadership สำหรับจัดตำแหน่งหัวหน้า/รองหัวหน้าเวรแยกผลัด
CREATE TABLE IF NOT EXISTS public.shift_leadership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_code VARCHAR(5) NOT NULL CHECK (shift_code IN ('M', 'T', 'W', 'Th', 'F', 'S')),
  position VARCHAR(12) NOT NULL CHECK (position IN ('HEAD', 'DEPUTY')),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  assigned_by VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shift_leadership_one_position_per_shift UNIQUE (shift_code, position),
  CONSTRAINT shift_leadership_member_once_per_shift UNIQUE (member_id, shift_code)
);

CREATE INDEX IF NOT EXISTS idx_shift_leadership_shift ON public.shift_leadership(shift_code);
CREATE INDEX IF NOT EXISTS idx_shift_leadership_member ON public.shift_leadership(member_id);

-- 2. ย้ายข้อมูลหัวหน้าเวรเดิมเข้าสู่ตารางใหม่ (Backfill legacy leaders)
WITH legacy AS (
  SELECT id AS member_id,
         CASE
           WHEN duty_day IN ('Ts', 'TSS', 'TsS', 'Th', 'ThS') THEN 'Th'
           WHEN duty_day = 'S' THEN 'S'
           WHEN duty_day IN ('M', 'MS') THEN 'M'
           WHEN duty_day IN ('T', 'TS') THEN 'T'
           WHEN duty_day IN ('W', 'WS') THEN 'W'
           WHEN duty_day IN ('F', 'FS') THEN 'F'
           ELSE NULL
         END AS shift_code,
         CASE shift_role WHEN 'SHIFT_HEAD' THEN 'HEAD' WHEN 'SHIFT_DEPUTY' THEN 'DEPUTY' END AS position
    FROM public.members
   WHERE shift_role IN ('SHIFT_HEAD', 'SHIFT_DEPUTY')
),
unambiguous AS (
  SELECT member_id, shift_code, position
    FROM legacy
   WHERE shift_code IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM legacy other
        WHERE other.shift_code = legacy.shift_code
          AND other.position = legacy.position
          AND other.member_id <> legacy.member_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM legacy other
        WHERE other.member_id = legacy.member_id
          AND other.shift_code = legacy.shift_code
          AND other.position <> legacy.position
     )
)
INSERT INTO public.shift_leadership (member_id, shift_code, position)
SELECT member_id, shift_code, position FROM unambiguous
ON CONFLICT DO NOTHING;

-- 3. อัปเดตข้อมูลรหัสเวรวันพฤหัสบดี Ts -> Th, TSS/TsS -> ThS ในทุกตาราง
DO $$
BEGIN
  -- อัปเดตตาราง members
  UPDATE public.members
     SET duty_day = CASE
           WHEN duty_day = 'Ts' THEN 'Th'
           WHEN duty_day IN ('TSS', 'TsS') THEN 'ThS'
           ELSE duty_day
         END,
         duty_id = CASE
           WHEN duty_id ~ '^TSS[0-9]*$' OR duty_id ~ '^TsS[0-9]*$'
             THEN 'ThS' || COALESCE(substring(duty_id FROM '[0-9]+$'), '')
           WHEN duty_id ~ '^Ts[0-9]*$'
             THEN 'Th' || COALESCE(substring(duty_id FROM '[0-9]+$'), '')
           ELSE duty_id
         END
   WHERE duty_day IN ('Ts', 'TSS', 'TsS')
      OR duty_id ~ '^(Ts|TSS|TsS)[0-9]*$';

  -- อัปเดตตาราง leave_requests (ถ้ามีตาราง)
  IF to_regclass('public.leave_requests') IS NOT NULL THEN
    UPDATE public.leave_requests
       SET duty_day = CASE WHEN duty_day = 'Ts' THEN 'Th' ELSE 'ThS' END
     WHERE duty_day IN ('Ts', 'TSS', 'TsS');
  END IF;

  -- อัปเดตตาราง cases (ถ้ามีตาราง)
  IF to_regclass('public.cases') IS NOT NULL THEN
    UPDATE public.cases
       SET assigned_duty_day = CASE WHEN assigned_duty_day = 'Ts' THEN 'Th' ELSE 'ThS' END
     WHERE assigned_duty_day IN ('Ts', 'TSS', 'TsS');
  END IF;

  -- อัปเดตตาราง duty_logs (ถ้ามีตาราง)
  IF to_regclass('public.duty_logs') IS NOT NULL THEN
    UPDATE public.duty_logs
       SET duty_day = CASE WHEN duty_day = 'Ts' THEN 'Th' ELSE 'ThS' END
     WHERE duty_day IN ('Ts', 'TSS', 'TsS');
  END IF;

  -- อัปเดตตาราง lost_items (ถ้ามีตาราง)
  IF to_regclass('public.lost_items') IS NOT NULL THEN
    UPDATE public.lost_items
       SET finder_duty_id = CASE
             WHEN finder_duty_id ~ '^TSS[0-9]*$' OR finder_duty_id ~ '^TsS[0-9]*$'
               THEN 'ThS' || COALESCE(substring(finder_duty_id FROM '[0-9]+$'), '')
             WHEN finder_duty_id ~ '^Ts[0-9]*$'
               THEN 'Th' || COALESCE(substring(finder_duty_id FROM '[0-9]+$'), '')
             ELSE finder_duty_id
           END,
           delivered_by_duty_id = CASE
             WHEN delivered_by_duty_id ~ '^TSS[0-9]*$' OR delivered_by_duty_id ~ '^TsS[0-9]*$'
               THEN 'ThS' || COALESCE(substring(delivered_by_duty_id FROM '[0-9]+$'), '')
             WHEN delivered_by_duty_id ~ '^Ts[0-9]*$'
               THEN 'Th' || COALESCE(substring(delivered_by_duty_id FROM '[0-9]+$'), '')
             ELSE delivered_by_duty_id
           END
     WHERE finder_duty_id ~ '^(Ts|TSS|TsS)[0-9]*$'
        OR delivered_by_duty_id ~ '^(Ts|TSS|TsS)[0-9]*$';
  END IF;

  -- อัปเดตตาราง attendance_scan_sessions (ถ้ามีตาราง)
  IF to_regclass('public.attendance_scan_sessions') IS NOT NULL THEN
    EXECUTE 'UPDATE public.attendance_scan_sessions SET shift_code = CASE WHEN shift_code = ''Ts'' THEN ''Th'' ELSE ''ThS'' END WHERE shift_code IN (''Ts'', ''TSS'', ''TsS'');';
  END IF;

  -- อัปเดตตาราง attendance_records (ถ้ามีตาราง)
  IF to_regclass('public.attendance_records') IS NOT NULL THEN
    EXECUTE 'UPDATE public.attendance_records SET shift_code = CASE WHEN shift_code = ''Ts'' THEN ''Th'' ELSE ''ThS'' END, duty_id = CASE WHEN duty_id ~ ''^TSS[0-9]*$'' OR duty_id ~ ''^TsS[0-9]*$'' THEN ''ThS'' || COALESCE(substring(duty_id FROM ''[0-9]+$''), '''') WHEN duty_id ~ ''^Ts[0-9]*$'' THEN ''Th'' || COALESCE(substring(duty_id FROM ''[0-9]+$''), '''') ELSE duty_id END WHERE shift_code IN (''Ts'', ''TSS'', ''TsS'') OR duty_id ~ ''^(Ts|TSS|TsS)[0-9]*$'';';
  END IF;

END $$;

COMMIT;
