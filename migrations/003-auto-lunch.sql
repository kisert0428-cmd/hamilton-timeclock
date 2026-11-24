CREATE TABLE lunch_policies (
  id uuid PRIMARY KEY,
  enabled boolean NOT NULL,
  deduction_minutes integer NOT NULL DEFAULT 30 CHECK(deduction_minutes=30),
  minimum_shift_minutes integer NOT NULL DEFAULT 360 CHECK(minimum_shift_minutes=360),
  effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  admin_id uuid REFERENCES admins(id),
  reason text NOT NULL
);
CREATE INDEX lunch_policies_effective ON lunch_policies(effective_at DESC);
INSERT INTO lunch_policies(id,enabled,reason) VALUES ('00300000-0000-4000-8000-000000000001',true,'Initial requested policy: 30 minutes unpaid lunch on completed shifts of at least 6 hours, effective for new shifts from activation.');
CREATE TABLE lunch_exceptions (
  id uuid PRIMARY KEY,
  clock_in_id uuid NOT NULL REFERENCES punches(id),
  waived boolean NOT NULL,
  admin_id uuid NOT NULL REFERENCES admins(id),
  reason text NOT NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX lunch_exceptions_shift ON lunch_exceptions(clock_in_id,at DESC);
