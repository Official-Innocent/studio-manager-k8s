-- ─────────────────────────────────────────────────────────────────────────────
-- S10 demo seed data
-- Fake interview-demo data for k3-demo.biggshotsmedia.com — fully isolated
-- from production (biggshots_demo DB)
--
-- UUID scheme: a1XXXXXX = admin, c1 = clients, b1 = bookings, d1 = projects,
--               e1 = invoices, f1 = payments, g1 = galleries, p1 = photos,
--               q1 = quotes, pp1 = payment_plans, pi1 = installments
-- All identifiers below are valid hex digits (0-9, a-f).
-- ─────────────────────────────────────────────────────────────────────────────

-- Admin user (password: "DemoPassword123!")
INSERT INTO admin_users (id, email, password_hash, name, role, created_at)
VALUES (
  'a1000000-0000-0000-0000-000000000001',
  'admin@demo.biggshotsmedia.com',
  '$2a$12$1QhyREpRPNek4n8f2IsqaO5Q9gSTbrOJxH3U0LUcEYFIMyfoCiwry',
  'Adak José (Demo)',
  'owner',
  now()
);

-- ── Clients across different pipeline stages ───────────────────────────────
INSERT INTO clients (id, email, password_hash, first_name, last_name, phone, address, notes, is_active, portal_enabled, marketing_consent, status, tags, created_at)
VALUES
  ('c1000000-0000-0000-0000-000000000001', 'emma.thompson@example.com',  NULL, 'Emma',  'Thompson', '+447700100001', 'Northampton, NN1 2AB',  'Enquired via Instagram, very keen on autumn colours.', true, true,  true,  'lead',     ARRAY['wedding','instagram'], now() - INTERVAL '3 days'),
  ('c1000000-0000-0000-0000-000000000002', 'james.okafor@example.com',   NULL, 'James', 'Okafor',   '+447700100002', 'Kettering, NN15 6QZ',   'Wants a Gold package, asked about second photographer.', true, true,  true,  'prospect', ARRAY['wedding'],            now() - INTERVAL '10 days'),
  ('c1000000-0000-0000-0000-000000000003', 'priya.shah@example.com',     NULL, 'Priya', 'Shah',     '+447700100003', 'Bedford, MK40 1AA',     'Maternity session booked, due date late July.', true, true,  true,  'active',   ARRAY['maternity'],          now() - INTERVAL '20 days'),
  ('c1000000-0000-0000-0000-000000000004', 'liam.carter@example.com',    NULL, 'Liam',  'Carter',   '+447700100004', 'Wellingborough, NN8 1AA','Family portrait session, two children + dog.', true, true,  true,  'active',   ARRAY['family','portrait'],  now() - INTERVAL '35 days'),
  ('c1000000-0000-0000-0000-000000000005', 'sophie.bennett@example.com', NULL, 'Sophie','Bennett',  '+447700100005', 'Milton Keynes, MK9 1AA','Wedding gallery delivered, left a 5-star review.', true, true,  true,  'delivered',ARRAY['wedding','vip'],      now() - INTERVAL '90 days'),
  ('c1000000-0000-0000-0000-000000000006', 'tom.reid@example.com',       NULL, 'Tom',   'Reid',     '+447700100006', 'Leicester, LE1 1AA',    'Headshots for new business launch.', true, true,  false, 'archived', ARRAY['headshots','commercial'], now() - INTERVAL '180 days');

-- ── Bookings ─────────────────────────────────────────────────────────────────
INSERT INTO bookings (id, client_id, first_name, last_name, email, phone, session_type, session_date, session_time, duration_hours, location, notes, status, payment_status, amount_total, amount_paid, contract_signed, contract_signed_at, enquiry_source, created_at)
VALUES
  ('b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Emma',  'Thompson', 'emma.thompson@example.com',  '+447700100001', 'Wedding Photography', CURRENT_DATE + INTERVAL '120 days', '11:00', 8,   'Delapre Abbey, Northampton', 'Autumn wedding, outdoor ceremony with indoor backup.', 'pending',   'unpaid',       1600.00,    0.00, false, NULL, 'instagram', now() - INTERVAL '3 days'),
  ('b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 'James', 'Okafor',   'james.okafor@example.com',   '+447700100002', 'Wedding Photography', CURRENT_DATE + INTERVAL '75 days',  '12:00', 6,   'The Orangery, Kettering',   'Gold package, asked about a second photographer add-on.', 'confirmed', 'deposit_paid', 1200.00,  350.00, true,  now() - INTERVAL '2 days', 'referral', now() - INTERVAL '10 days'),
  ('b1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003', 'Priya', 'Shah',     'priya.shah@example.com',     '+447700100003', 'Maternity Session',   CURRENT_DATE + INTERVAL '14 days',  '10:00', 1.5, 'Studio',                    'Gold maternity package, partner attending.', 'confirmed', 'deposit_paid', 300.00,   100.00, true,  now() - INTERVAL '15 days', 'google', now() - INTERVAL '20 days'),
  ('b1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000004', 'Liam',  'Carter',   'liam.carter@example.com',    '+447700100004', 'Family Portraits',    CURRENT_DATE - INTERVAL '5 days',   '14:00', 2,   'Sywell Country Park',       'Family of 4 plus dog, golden hour session.', 'completed', 'paid',         420.00,   420.00, true,  now() - INTERVAL '40 days', 'returning_client', now() - INTERVAL '35 days'),
  ('b1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000005', 'Sophie','Bennett',  'sophie.bennett@example.com', '+447700100005', 'Wedding Photography', CURRENT_DATE - INTERVAL '60 days',  '11:30', 8,   'Woodland Manor, MK',        'Full diamond package, second photographer included.', 'completed', 'paid',         2200.00, 2200.00, true,  now() - INTERVAL '95 days', 'wedding_fair', now() - INTERVAL '90 days'),
  ('b1000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000006', 'Tom',   'Reid',     'tom.reid@example.com',       '+447700100006', 'Headshots',           CURRENT_DATE - INTERVAL '170 days', '09:00', 1,   'Studio',                    'Business headshots for 3 team members.', 'completed', 'paid',         255.00,   255.00, true,  now() - INTERVAL '178 days', 'bark', now() - INTERVAL '180 days');

-- ── Projects (linked to bookings, across pipeline stages) ────────────────────
INSERT INTO projects (id, booking_id, client_id, title, stage, session_type, session_date, session_location, notes, amount_quoted, amount_invoiced, deposit_paid, balance_paid, delivery_due_date, balance_due_date, follow_up_flag, follow_up_date, created_at)
VALUES
  ('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Emma & Partner — Autumn Wedding',     'lead',          'Wedding Photography', CURRENT_DATE + INTERVAL '120 days', 'Delapre Abbey, Northampton', 'Awaiting quote acceptance.', 1600.00,    NULL,    0.00,    0.00, NULL,                                NULL, true,  CURRENT_DATE + INTERVAL '3 days', now() - INTERVAL '3 days'),
  ('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 'James & Partner — Gold Wedding',      'booked',        'Wedding Photography', CURRENT_DATE + INTERVAL '75 days',  'The Orangery, Kettering',    'Deposit paid, balance due 14 days before.', 1200.00,  350.00,  350.00,    0.00, CURRENT_DATE + INTERVAL '95 days',  CURRENT_DATE + INTERVAL '61 days', false, NULL, now() - INTERVAL '10 days'),
  ('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003', 'Priya — Maternity Shoot',              'covered',          'Maternity Session',  CURRENT_DATE + INTERVAL '14 days',  'Studio',                     'Deposit paid, scheduled for next 2 weeks.', 300.00,   100.00,  100.00,    0.00, CURRENT_DATE + INTERVAL '28 days',  CURRENT_DATE + INTERVAL '7 days',  false, NULL, now() - INTERVAL '20 days'),
  ('d1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000004', 'Liam — Family Session',               'delivered',      'Family Portraits',  CURRENT_DATE - INTERVAL '5 days',   'Sywell Country Park',        'Shoot complete, editing in progress.', 420.00,   420.00,    0.00,  420.00, CURRENT_DATE + INTERVAL '9 days',   NULL, false, NULL, now() - INTERVAL '35 days'),
  ('d1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000005', 'Sophie & Partner — Diamond Wedding',  'completed',     'Wedding Photography', CURRENT_DATE - INTERVAL '60 days',  'Woodland Manor, MK',         'Gallery delivered, review received.', 2200.00, 2200.00,  600.00, 1600.00, CURRENT_DATE - INTERVAL '32 days',  NULL, false, NULL, now() - INTERVAL '90 days'),
  ('d1000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000006', 'Tom — Business Headshots',            'completed',     'Headshots',           CURRENT_DATE - INTERVAL '170 days', 'Studio',                     'Delivered and invoiced.', 255.00,   255.00,    0.00,  255.00, CURRENT_DATE - INTERVAL '163 days', NULL, false, NULL, now() - INTERVAL '180 days');

-- ── Quote for the lead (Emma) ────────────────────────────────────────────────
INSERT INTO quotes (id, project_id, client_id, quote_number, status, line_items, subtotal, total, valid_until, notes, client_message, sent_at, created_at)
VALUES (
  'a2000000-0000-0000-0000-000000000001',
  'd1000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000001',
  'QUO-DEMO-0001',
  'sent',
  '[{"description":"Wedding Photography — Gold Package (6 hours, 1 photographer, 275 edited photos)","quantity":1,"total":1200.00},{"description":"Additional 2 hours coverage","quantity":1,"total":300.00},{"description":"Printed photo album upgrade","quantity":1,"total":100.00}]',
  1600.00, 1600.00,
  CURRENT_DATE + INTERVAL '14 days',
  'Includes travel within 30 miles of Rushden.',
  'Hi Emma, thanks so much for your enquiry — here''s a quote for your autumn wedding. Let me know if you''d like any adjustments!',
  now() - INTERVAL '2 days',
  now() - INTERVAL '3 days'
);

-- ── Invoices ──────────────────────────────────────────────────────────────────
INSERT INTO invoices (id, invoice_number, booking_id, client_id, client_name, client_email, line_items, subtotal, total, amount_paid, status, due_date, project_id, invoice_type, created_at)
VALUES
  ('e1000000-0000-0000-0000-000000000001', 'INV-DEMO-0001', 'b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 'James Okafor', 'james.okafor@example.com', '[{"description":"Wedding deposit — Gold Package","quantity":1,"total":350.00}]', 350.00, 350.00, 350.00, 'paid', CURRENT_DATE - INTERVAL '2 days', 'd1000000-0000-0000-0000-000000000002', 'deposit', now() - INTERVAL '5 days'),
  ('e1000000-0000-0000-0000-000000000002', 'INV-DEMO-0002', 'b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 'James Okafor', 'james.okafor@example.com', '[{"description":"Wedding balance — Gold Package","quantity":1,"total":850.00}]', 850.00, 850.00, 0.00,   'sent', CURRENT_DATE + INTERVAL '61 days', 'd1000000-0000-0000-0000-000000000002', 'balance', now() - INTERVAL '5 days'),
  ('e1000000-0000-0000-0000-000000000003', 'INV-DEMO-0003', 'b1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003', 'Priya Shah',   'priya.shah@example.com',   '[{"description":"Maternity deposit — Gold Package","quantity":1,"total":100.00}]', 100.00, 100.00, 100.00, 'paid', CURRENT_DATE - INTERVAL '15 days', 'd1000000-0000-0000-0000-000000000003', 'deposit', now() - INTERVAL '18 days'),
  ('e1000000-0000-0000-0000-000000000004', 'INV-DEMO-0004', 'b1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000004', 'Liam Carter',  'liam.carter@example.com',  '[{"description":"Family Portrait Session — Platinum Package","quantity":1,"total":420.00}]', 420.00, 420.00, 420.00, 'paid', CURRENT_DATE - INTERVAL '35 days', 'd1000000-0000-0000-0000-000000000004', 'deposit', now() - INTERVAL '35 days'),
  ('e1000000-0000-0000-0000-000000000005', 'INV-DEMO-0005', 'b1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000005', 'Sophie Bennett','sophie.bennett@example.com', '[{"description":"Wedding deposit — Diamond Package","quantity":1,"total":600.00}]', 600.00, 600.00, 600.00, 'paid', CURRENT_DATE - INTERVAL '95 days', 'd1000000-0000-0000-0000-000000000005', 'deposit', now() - INTERVAL '95 days'),
  ('e1000000-0000-0000-0000-000000000006', 'INV-DEMO-0006', 'b1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000005', 'Sophie Bennett','sophie.bennett@example.com', '[{"description":"Wedding balance — Diamond Package","quantity":1,"total":1600.00}]', 1600.00, 1600.00, 1600.00, 'paid', CURRENT_DATE - INTERVAL '32 days', 'd1000000-0000-0000-0000-000000000005', 'balance', now() - INTERVAL '60 days'),
  ('e1000000-0000-0000-0000-000000000007', 'INV-DEMO-0007', 'b1000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000006', 'Tom Reid',     'tom.reid@example.com',     '[{"description":"Business Headshots — Gold Package","quantity":1,"total":255.00}]', 255.00, 255.00, 255.00, 'paid', CURRENT_DATE - INTERVAL '163 days', 'd1000000-0000-0000-0000-000000000006', 'deposit', now() - INTERVAL '178 days');

-- ── Payments ──────────────────────────────────────────────────────────────────
INSERT INTO payments (id, invoice_id, booking_id, amount, currency, method, status, provider_ref, created_at)
VALUES
  ('f1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 350.00,  'GBP', 'card',          'completed', 'DEMO-PI-0001', now() - INTERVAL '5 days'),
  ('f1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003', 100.00,  'GBP', 'card',          'completed', 'DEMO-PI-0002', now() - INTERVAL '18 days'),
  ('f1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000004', 420.00,  'GBP', 'bank_transfer', 'completed', 'DEMO-REF-0003', now() - INTERVAL '35 days'),
  ('f1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000005', 600.00,  'GBP', 'card',          'completed', 'DEMO-PI-0004', now() - INTERVAL '95 days'),
  ('f1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000005', 1600.00, 'GBP', 'bank_transfer', 'completed', 'DEMO-REF-0005', now() - INTERVAL '60 days'),
  ('f1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000007', 'b1000000-0000-0000-0000-000000000006', 255.00,  'GBP', 'card',          'completed', 'DEMO-PI-0006', now() - INTERVAL '178 days');

-- ── Payment plan + installments for James (Gold Wedding, in progress) ────────
INSERT INTO payment_plans (id, project_id, client_id, total_amount, amount_paid, status, created_at)
VALUES (
  'b2000000-0000-0000-0000-000000000001',
  'd1000000-0000-0000-0000-000000000002',
  'c1000000-0000-0000-0000-000000000002',
  1200.00, 350.00, 'active', now() - INTERVAL '10 days'
);

INSERT INTO payment_installments (id, plan_id, project_id, client_id, installment_num, label, amount, due_date, status, is_deposit, is_non_refundable, paid_at, paid_amount, payment_method, invoice_id, created_at)
VALUES
  ('c2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 1, 'Booking Deposit', 350.00, CURRENT_DATE - INTERVAL '2 days', 'paid',    true,  true,  now() - INTERVAL '2 days', 350.00, 'card', 'e1000000-0000-0000-0000-000000000001', now() - INTERVAL '10 days'),
  ('c2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 2, 'Balance Payment', 850.00, CURRENT_DATE + INTERVAL '61 days', 'pending', false, false, NULL, NULL, NULL, 'e1000000-0000-0000-0000-000000000002', now() - INTERVAL '10 days');

-- ── Galleries (delivered for Sophie + Liam, in-progress for Priya) ───────────
INSERT INTO galleries (id, client_id, booking_id, title, slug, description, session_date, is_published, allow_downloads, allow_sharing, show_watermark, display_style, delivered_at, created_at)
VALUES
  ('b3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000005', 'Sophie & Partner — Wedding Gallery', 'sophie-bennett-wedding', 'Full wedding day coverage at Woodland Manor.', CURRENT_DATE - INTERVAL '60 days', true,  true, true,  false, 'standard', now() - INTERVAL '32 days', now() - INTERVAL '40 days'),
  ('b3000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000004', 'Liam Carter — Family Session',      'liam-carter-family',     'Golden hour family session at Sywell Country Park.', CURRENT_DATE - INTERVAL '5 days', false, true, false, true,  'standard', NULL, now() - INTERVAL '4 days');

-- ── Promotions (one active banner for the homepage/portal demo) ──────────────
INSERT INTO promotions (id, type, message, eyebrow, cta_label, cta_link, bg_colour, show_countdown, active, starts_at, ends_at, created_at)
VALUES (
  1, 'banner',
  'Summer booking offer — 10% off all portrait and family sessions booked this month.',
  'Limited Time',
  'Book Now',
  '#contact',
  'gold',
  true,
  true,
  now() - INTERVAL '2 days',
  now() + INTERVAL '12 days',
  now() - INTERVAL '2 days'
);

-- ── Tasks (mix of open/completed, across projects) ───────────────────────────
INSERT INTO tasks (id, type, title, description, priority, status, client_id, booking_id, project_id, due_date, created_at)
VALUES
  (1, 'follow_up',    'Follow up on Emma''s quote',          'Sent quote 3 days ago, no response yet — send a friendly check-in.', 'medium', 'open',      'c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', CURRENT_DATE + INTERVAL '3 days', now() - INTERVAL '1 day'),
  (2, 'balance_due',  'Balance payment due — James Okafor',  'Wedding balance invoice due in just over 2 months.', 'low',    'open',      'c1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', CURRENT_DATE + INTERVAL '61 days', now() - INTERVAL '5 days'),
  (3, 'edit_reminder','Begin editing — Liam Carter family shoot', 'Shoot completed 5 days ago, 14-day delivery target.', 'high',   'open',      'c1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000004', CURRENT_DATE + INTERVAL '9 days', now() - INTERVAL '5 days'),
  (4, 'review_request','Request review — Sophie Bennett',     'Gallery delivered, ask for a Google review.', 'medium', 'completed', 'c1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000005', CURRENT_DATE - INTERVAL '28 days', now() - INTERVAL '32 days');

-- ── Questionnaire templates ───────────────────────────────────────────────────
INSERT INTO questionnaire_templates (id, name, session_type, questions, created_at)
VALUES (
  'd2000000-0000-0000-0000-000000000001',
  'Wedding Day Questionnaire',
  'Wedding Photography',
  '[{"id":"q1","label":"What time does the ceremony start?","type":"text"},{"id":"q2","label":"Who are the key people we should make sure to photograph?","type":"textarea"},{"id":"q3","label":"Do you have a shot list or any must-have photos?","type":"textarea"},{"id":"q4","label":"Is there a second photographer?","type":"select","options":["Yes","No"]}]',
  now() - INTERVAL '200 days'
);

-- ── Questionnaire sent to James (in progress) ─────────────────────────────────
INSERT INTO questionnaires (id, project_id, client_id, template_id, title, questions, answers, status, sent_at, created_at)
VALUES (
  'e2000000-0000-0000-0000-000000000001',
  'd1000000-0000-0000-0000-000000000002',
  'c1000000-0000-0000-0000-000000000002',
  'd2000000-0000-0000-0000-000000000001',
  'Wedding Day Questionnaire — James & Partner',
  '[{"id":"q1","label":"What time does the ceremony start?","type":"text"},{"id":"q2","label":"Who are the key people we should make sure to photograph?","type":"textarea"},{"id":"q3","label":"Do you have a shot list or any must-have photos?","type":"textarea"},{"id":"q4","label":"Is there a second photographer?","type":"select","options":["Yes","No"]}]',
  '{}',
  'sent',
  now() - INTERVAL '4 days',
  now() - INTERVAL '4 days'
);

-- ── Contract template ──────────────────────────────────────────────────────────
INSERT INTO contract_templates (id, name, contract_type, body, is_default, created_at)
VALUES (
  'f2000000-0000-0000-0000-000000000001',
  'Standard Photography Agreement',
  'general',
  'This agreement is between Bigg Shots Media ("the Studio") and the Client for the provision of photography services as outlined in the booking confirmation. A non-refundable deposit secures the date. The balance is due before the session unless otherwise agreed in writing. Delivery timelines are estimates and may vary during peak season.',
  true,
  now() - INTERVAL '200 days'
);

-- ── Client loyalty record (Sophie — repeat/VIP client) ────────────────────────
INSERT INTO client_loyalty (id, client_id, total_sessions, current_cycle, threshold, discount_pct, award_count, created_at)
VALUES (
  'a3000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000005',
  3, 0, 3, 10, 1,
  now() - INTERVAL '90 days'
);

-- ── Site settings (CMS content for homepage demo) ─────────────────────────────
INSERT INTO site_settings (key, value, updated_at)
VALUES
  ('hero_tagline',        'Photography & films across The Midlands & beyond — demo environment',                 now()),
  ('about_title',         'Every frame tells<br>a <em>story</em> (Demo)',                                          now()),
  ('about_body',          'This is a seeded demo environment for Bigg Shots Media, showcasing the admin dashboard, client portal, and booking pipeline with realistic sample data.', now()),
  ('about_signature',     'Adak José (Demo)',                                                                      now()),
  ('testimonial_1_text',  'The whole experience was seamless from booking to gallery delivery — highly recommend!', now()),
  ('testimonial_1_author','Sophie Bennett',                                                                        now()),
  ('testimonial_1_session','Wedding Photography',                                                                  now()),
  ('coverage_text',       'This is a demo environment. In production, this text describes the studio''s coverage area.', now());

-- ── Fix sequences for tables with explicit integer IDs above ──────────────────
-- (inserted rows don't advance SERIAL sequences, so reset to avoid collisions
--  on the next admin-created promotion/task)
SELECT setval('promotions_id_seq', (SELECT COALESCE(MAX(id), 1) FROM promotions));
SELECT setval('tasks_id_seq',      (SELECT COALESCE(MAX(id), 1) FROM tasks));

