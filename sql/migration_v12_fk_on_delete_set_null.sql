-- ==============================================================================
-- 🚀 MIGRATION V12: Fix Foreign Key Constraints on members (ON DELETE SET NULL)
-- ==============================================================================
-- ป้องกันข้อผิดพลาด "violates foreign key constraint cases_assigned_officer_id_fkey"
-- เมื่อทำการลบข้อมูลสารวัตรนักเรียนออกจากระบบ

-- 1. ตาราง cases (คดี): เมื่อลบสารวัตร ให้เคลียร์ช่อง assigned_officer_id เป็น NULL อัตโนมัติ
ALTER TABLE IF EXISTS public.cases 
  DROP CONSTRAINT IF EXISTS cases_assigned_officer_id_fkey,
  ADD CONSTRAINT cases_assigned_officer_id_fkey 
  FOREIGN KEY (assigned_officer_id) 
  REFERENCES public.members(id) 
  ON DELETE SET NULL;

-- 2. ตาราง duty_logs (บันทึกตรวจเวร): เมื่อลบสารวัตร ให้เคลียร์ช่อง reported_by_id เป็น NULL
ALTER TABLE IF EXISTS public.duty_logs 
  DROP CONSTRAINT IF EXISTS duty_logs_reported_by_id_fkey,
  ADD CONSTRAINT duty_logs_reported_by_id_fkey 
  FOREIGN KEY (reported_by_id) 
  REFERENCES public.members(id) 
  ON DELETE SET NULL;
