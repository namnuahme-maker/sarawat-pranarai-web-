-- Rollback for migration_v11_thursday_th_code.sql.
-- Run only after reverting the web and bot builds to the Ts/TSS version.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.members source
    JOIN public.members target
      ON target.duty_id = CASE
        WHEN source.duty_id ~ '^ThS[0-9]*$' THEN 'TSS' || COALESCE(substring(source.duty_id FROM '[0-9]+$'), '')
        ELSE 'Ts' || COALESCE(substring(source.duty_id FROM '[0-9]+$'), '')
      END
     AND target.id <> source.id
    WHERE source.duty_id ~ '^ThS?[0-9]*$'
  ) THEN
    RAISE EXCEPTION 'Rollback duty ID collision; resolve Ts/TSS IDs before retrying';
  END IF;

  IF EXISTS (
    SELECT target_duty_id FROM (
      SELECT CASE
        WHEN duty_id ~ '^ThS[0-9]*$' THEN 'TSS' || COALESCE(substring(duty_id FROM '[0-9]+$'), '')
        ELSE 'Ts' || COALESCE(substring(duty_id FROM '[0-9]+$'), '')
      END AS target_duty_id
      FROM public.members
      WHERE duty_id ~ '^ThS?[0-9]*$'
    ) mapped
    GROUP BY target_duty_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple Th/ThS duty IDs map to the same rollback ID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shift_leadership
     WHERE shift_code IN ('Th', 'Ts')
     GROUP BY position HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Rollback leadership collision; keep one assignment per position before retrying';
  END IF;
END $$;

ALTER TABLE public.shift_leadership
  DROP CONSTRAINT IF EXISTS shift_leadership_shift_code_check;

UPDATE public.members
   SET duty_day = CASE WHEN duty_day = 'Th' THEN 'Ts' WHEN duty_day = 'ThS' THEN 'TSS' ELSE duty_day END,
       duty_id = CASE
     WHEN duty_id ~ '^ThS[0-9]*$' THEN 'TSS' || COALESCE(substring(duty_id FROM '[0-9]+$'), '')
     WHEN duty_id ~ '^Th[0-9]*$' THEN 'Ts' || COALESCE(substring(duty_id FROM '[0-9]+$'), '')
     ELSE duty_id
   END
 WHERE duty_day IN ('Th', 'ThS') OR duty_id ~ '^ThS?[0-9]*$';

UPDATE public.shift_leadership SET shift_code = 'Ts' WHERE shift_code = 'Th';
ALTER TABLE public.shift_leadership
  ADD CONSTRAINT shift_leadership_shift_code_check
  CHECK (shift_code IN ('M', 'T', 'W', 'Ts', 'F', 'S'));

UPDATE public.leave_requests SET duty_day = CASE WHEN duty_day = 'Th' THEN 'Ts' ELSE 'TSS' END WHERE duty_day IN ('Th', 'ThS');
UPDATE public.cases SET assigned_duty_day = CASE WHEN assigned_duty_day = 'Th' THEN 'Ts' ELSE 'TSS' END WHERE assigned_duty_day IN ('Th', 'ThS');
UPDATE public.duty_logs SET duty_day = CASE WHEN duty_day = 'Th' THEN 'Ts' ELSE 'TSS' END WHERE duty_day IN ('Th', 'ThS');
DO $$
BEGIN
  IF to_regclass('public.attendance_scan_sessions') IS NOT NULL THEN
    EXECUTE $q$
      UPDATE public.attendance_scan_sessions
         SET shift_code = CASE WHEN shift_code = 'Th' THEN 'Ts' ELSE 'TSS' END
       WHERE shift_code IN ('Th', 'ThS')
    $q$;
  END IF;

  IF to_regclass('public.attendance_records') IS NOT NULL THEN
    EXECUTE $q$
      UPDATE public.attendance_records
         SET shift_code = CASE WHEN shift_code = 'Th' THEN 'Ts' WHEN shift_code = 'ThS' THEN 'TSS' ELSE shift_code END,
             duty_id = CASE
           WHEN duty_id ~ '^ThS[0-9]*$' THEN 'TSS' || COALESCE(substring(duty_id FROM '[0-9]+$'), '')
           WHEN duty_id ~ '^Th[0-9]*$' THEN 'Ts' || COALESCE(substring(duty_id FROM '[0-9]+$'), '')
           ELSE duty_id
         END
       WHERE shift_code IN ('Th', 'ThS') OR duty_id ~ '^ThS?[0-9]*$'
    $q$;
  END IF;

  IF to_regclass('public.lost_items') IS NOT NULL THEN
    EXECUTE $q$
      UPDATE public.lost_items
         SET finder_duty_id = CASE
               WHEN finder_duty_id ~ '^ThS[0-9]*$' THEN 'TSS' || COALESCE(substring(finder_duty_id FROM '[0-9]+$'), '')
               WHEN finder_duty_id ~ '^Th[0-9]*$' THEN 'Ts' || COALESCE(substring(finder_duty_id FROM '[0-9]+$'), '')
               ELSE finder_duty_id
             END,
             delivered_by_duty_id = CASE
               WHEN delivered_by_duty_id ~ '^ThS[0-9]*$' THEN 'TSS' || COALESCE(substring(delivered_by_duty_id FROM '[0-9]+$'), '')
               WHEN delivered_by_duty_id ~ '^Th[0-9]*$' THEN 'Ts' || COALESCE(substring(delivered_by_duty_id FROM '[0-9]+$'), '')
               ELSE delivered_by_duty_id
             END
       WHERE finder_duty_id ~ '^ThS?[0-9]*$' OR delivered_by_duty_id ~ '^ThS?[0-9]*$'
    $q$;
  END IF;
END $$;

COMMIT;
