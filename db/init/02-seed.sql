-- ─────────────────────────────────────────────────────────────────────────────
-- S6 integration test seed data
-- Fresh, fake data only — completely isolated from production (biggshots_dev DB)
-- UUID scheme: aXXXXXXX = admin, c = clients, b = bookings, d = projects,
--               e = invoices, f = payments (all valid hex digits)
-- ─────────────────────────────────────────────────────────────────────────────

-- Admin user (password: "DevPassword123!")
INSERT INTO admin_users (id, email, password_hash, name, role, created_at)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'admin@dev.local',
  '$2a$12$1QhyREpRPNek4n8f2IsqaO5Q9gSTbrOJxH3U0LUcEYFIMyfoCiwry',
  'Dev Admin',
  'owner',
  now()
);

-- Clients
INSERT INTO clients (id, email, password_hash, first_name, last_name, phone, is_active, portal_enabled, marketing_consent, created_at)
VALUES
  ('c0000000-0000-0000-0000-000000000001', 'alice@dev.local', NULL, 'Alice', 'Anderson', '+447700900001', true, true, true, now()),
  ('c0000000-0000-0000-0000-000000000002', 'bob@dev.local',   NULL, 'Bob',   'Brown',    '+447700900002', true, false, true, now()),
  ('c0000000-0000-0000-0000-000000000003', 'carol@dev.local', NULL, 'Carol', 'Clarke',   '+447700900003', true, true, false, now());

-- Bookings
INSERT INTO bookings (id, client_id, first_name, last_name, email, phone, session_type, session_date, session_time, duration_hours, location, status, payment_status, amount_total, amount_paid, contract_signed, created_at)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Alice', 'Anderson', 'alice@dev.local', '+447700900001', 'Wedding',  CURRENT_DATE + INTERVAL '30 days', '11:00', 8, 'Northampton', 'confirmed', 'deposit_paid', 1800.00, 450.00, true, now()),
  ('b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Bob',   'Brown',    'bob@dev.local',   '+447700900002', 'Portrait', CURRENT_DATE + INTERVAL '10 days', '14:00', 1, 'Studio',      'pending',   'unpaid',       150.00,   0.00, false, now()),
  ('b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'Carol', 'Clarke',   'carol@dev.local', '+447700900003', 'Maternity', CURRENT_DATE - INTERVAL '5 days',  '10:00', 2, 'Outdoor',     'completed', 'paid',         300.00, 300.00, true, now());

-- Projects (linked to bookings)
INSERT INTO projects (id, booking_id, client_id, title, stage, session_type, session_date, session_location, amount_quoted, deposit_paid, balance_paid, created_at)
VALUES
  ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Alice & Partner — Wedding',   'booked',   'Wedding',   CURRENT_DATE + INTERVAL '30 days', 'Northampton', 1800.00, 450.00, 0.00, now()),
  ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Bob — Portrait Session',      'lead',     'Portrait',  CURRENT_DATE + INTERVAL '10 days', 'Studio',      150.00,   0.00, 0.00, now()),
  ('d0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'Carol — Maternity Shoot',     'delivered','Maternity', CURRENT_DATE - INTERVAL '5 days',  'Outdoor',     300.00, 300.00, 0.00, now());

-- Invoices
INSERT INTO invoices (id, invoice_number, booking_id, client_id, client_name, client_email, line_items, subtotal, total, amount_paid, status, due_date, created_at)
VALUES
  ('e0000000-0000-0000-0000-000000000001', 'INV-DEV-0001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Alice Anderson', 'alice@dev.local', '[{"description":"Wedding deposit","quantity":1,"total":450.00}]', 450.00, 450.00, 450.00, 'paid', CURRENT_DATE + INTERVAL '7 days', now()),
  ('e0000000-0000-0000-0000-000000000002', 'INV-DEV-0002', 'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'Carol Clarke',   'carol@dev.local', '[{"description":"Maternity session — full payment","quantity":1,"total":300.00}]', 300.00, 300.00, 300.00, 'paid', CURRENT_DATE - INTERVAL '10 days', now());

-- Payments
INSERT INTO payments (id, invoice_id, booking_id, amount, currency, method, status, provider_ref, created_at)
VALUES
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 450.00, 'GBP', 'bank_transfer', 'completed', 'DEV-REF-001', now()),
  ('f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003', 300.00, 'GBP', 'bank_transfer', 'completed', 'DEV-REF-002', now());
