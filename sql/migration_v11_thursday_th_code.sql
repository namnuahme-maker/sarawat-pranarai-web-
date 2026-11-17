-- Thursday code migration: Ts -> Th, TSS/TsS -> ThS.
-- Deploy the compatibility-aware web and bot builds before applying this file.
-- Run in Supabase SQL Editor; the transaction rolls back on any detected collision.
BEGIN;

DO $$
DECLARE
  has_conflict BOOLEAN;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.members source
      JOIN public.members target
        ON target.duty_id = CASE
          WHEN source.duty_id ~ '^TSS[0-9]*$' OR source.duty_id ~ '^TsS[0-9]*$'
            THEN 'ThS' || COALESCE(substring(source.duty_id FROM '[0-9]+$'), '')
          ELSE 'Th' || COALESCE(substring(source.duty_id FROM '[0-9]+$'), '')
        END
       AND target.id <> source.id
     WHERE source.duty_id ~ '^(Ts|TSS|TsS)[0-9]*$'
  ) THEN
    RAISE EXCEPTION 'Thursday duty ID migration collision in members.duty_id; resolve duplicate Th/ThS IDs before retrying';
  END IF;

  IF to_regclass('public.shift_leadership') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.shift_leadership
     WHERE shift_code IN ('Ts', 'Th')
     GROUP BY position
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Thursday leadership assignments collide; keep one head and one deputy for Th before retrying';
  END IF;

  IF to_regclass('public.shift_leadership') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.shift_leadership
     WHERE shift_code IN ('Ts', 'Th')
     GROUP BY member_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'A member has both old and new Thursday leadership rows; resolve duplicates before retrying';
  END IF;

  IF to_regclass('public.attendance_scan_sessions') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM (
          SELECT CASE WHEN shift_code = 'Ts' THEN 'Th'
                      WHEN shift_code IN ('TSS', 'TsS') THEN 'ThS'
                      ELSE shift_code END AS canonical_shift,
                 duty_date
            FROM public.attendance_scan_sessions
           WHERE shift_code IN ('Ts', 'Th', 'TSS', 'TsS', 'ThS')
        ) sessions
         GROUP BY canonical_shift, duty_date HAVING COUNT(*) > 1
      )
    $q$ INTO has_conflict;
    IF has_conflict THEN
      RAISE EXCEPTION 'Thursday attendance sessions collide on the same date; resolve before retrying';
    END IF;
  END IF;

  IF to_regclass('public.attendance_records') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.attendance_records source
        JOIN public.attendance_records target
          ON target.duty_date = source.duty_date
         AND target.duty_id = CASE
           WHEN source.duty_id ~ '^TSS[0-9]*$' OR source.duty_id ~ '^TsS[0-9]*$'
             THEN 'ThS' || COALESCE(substring(source.duty_id FROM '[0-9]+$'), '')
           ELSE 'Th' || COALESCE(substring(source.duty_id FROM '[0-9]+$'), '')
         END
         AND target.id <> source.id
        WHERE source.duty_id ~ '^(Ts|TSS|TsS)[0-9]*$'
      )
    $q$ INTO has_conflict;
    IF has_conflict THEN
      RAISE EXCEPTION 'Thursday attendance record IDs collide; resolve duplicate Th/ThS records before retrying';
    END IF;
  END IF;
END $$;

-- The CHECK constraint in the original schema only permits the old code.
ALTER TABLE public.shift_leadership
  DROP CONSTRAINT IF EXISTS shift_leadership_shift_code_check;

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

UPDATE public.shift_leadership SET shift_code = 'Th' WHERE shift_code = 'Ts';
ALTER TABLE public.shift_leadership
  ADD CONSTRAINT shift_leadership_shift_code_check
  CHECK (shift_code IN ('M', 'T', 'W', 'Th', 'F', 'S'));

UPDATE public.leave_requests
   SET duty_day = CASE WHEN duty_day = 'Ts' THEN 'Th' ELSE 'ThS' END
 WHERE duty_day IN ('Ts', 'TSS', 'TsS');

UPDATE public.cases
   SET assigned_duty_day = CASE WHEN assigned_duty_day = 'Ts' THEN 'Th' ELSE 'ThS' END
 WHERE assigned_duty_day IN ('Ts', 'TSS', 'TsS');

UPDATE public.duty_logs
   SET duty_day = CASE WHEN duty_day = 'Ts' THEN 'Th' ELSE 'ThS' END
 WHERE duty_day IN ('Ts', 'TSS', 'TsS');

UPDATE public.attendance_scan_sessions
   SET shift_code = CASE WHEN shift_code = 'Ts' THEN 'Th' ELSE 'ThS' END
 WHERE shift_code IN ('Ts', 'TSS', 'TsS');

UPDATE public.attendance_records
   SET shift_code = CASE WHEN shift_code = 'Ts' THEN 'Th' ELSE 'ThS' END,
       duty_id = CASE
     WHEN duty_id ~ '^TSS[0-9]*$' OR duty_id ~ '^TsS[0-9]*$'
       THEN 'ThS' || COALESCE(substring(duty_id FROM '[0-9]+$'), '')
     WHEN duty_id ~ '^Ts[0-9]*$'
       THEN 'Th' || COALESCE(substring(duty_id FROM '[0-9]+$'), '')
     ELSE duty_id
   END
 WHERE shift_code IN ('Ts', 'TSS', 'TsS')
    OR duty_id ~ '^(Ts|TSS|TsS)[0-9]*$';

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

COMMIT;
