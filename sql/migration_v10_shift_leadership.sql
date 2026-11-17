-- Store leadership assignments per shift so a member can lead different shifts independently.
BEGIN;

CREATE TABLE IF NOT EXISTS shift_leadership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_code VARCHAR(5) NOT NULL CHECK (shift_code IN ('M', 'T', 'W', 'Ts', 'F', 'S')),
  position VARCHAR(12) NOT NULL CHECK (position IN ('HEAD', 'DEPUTY')),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  assigned_by VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shift_leadership_one_position_per_shift UNIQUE (shift_code, position),
  CONSTRAINT shift_leadership_member_once_per_shift UNIQUE (member_id, shift_code)
);

CREATE INDEX IF NOT EXISTS idx_shift_leadership_member ON shift_leadership(member_id);

-- Backfill legacy assignments only when the old global role maps unambiguously to one shift.
WITH legacy AS (
  SELECT id AS member_id,
         CASE
           WHEN duty_day IN ('Ts', 'TSS', 'TsS') THEN 'Ts'
           WHEN duty_day = 'S' THEN 'S'
           WHEN duty_day IN ('M', 'MS') THEN 'M'
           WHEN duty_day IN ('T', 'TS') THEN 'T'
           WHEN duty_day IN ('W', 'WS') THEN 'W'
           WHEN duty_day IN ('F', 'FS') THEN 'F'
           ELSE NULL
         END AS shift_code,
         CASE shift_role WHEN 'SHIFT_HEAD' THEN 'HEAD' WHEN 'SHIFT_DEPUTY' THEN 'DEPUTY' END AS position
    FROM members
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
INSERT INTO shift_leadership (member_id, shift_code, position)
SELECT member_id, shift_code, position FROM unambiguous
ON CONFLICT DO NOTHING;

COMMIT;
