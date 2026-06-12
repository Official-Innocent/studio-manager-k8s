'use strict';
const express = require('express');
const { query, transaction } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const emailService = require('../services/email');
const smsService   = require('../services/sms');
const router = express.Router();

// ── POST /payments/stripe/webhook (raw body required) ──────────────────────────
// NOTE: this route must be mounted BEFORE express.json() in index.js, or given
// its own raw-body parser ahead of the global json middleware.
router.post('/stripe/webhook',
  async (req, res) => {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === 'payment_intent.succeeded') {
        await handleStripePaymentSuccess(event.data.object);
      } else if (event.type === 'checkout.session.completed') {
        await handleCheckoutSessionCompleted(event.data.object, stripe);
      }
    } catch (err) {
      console.error('[Stripe Webhook] handler error:', err.message);
    }

    res.json({ received: true });
  }
);

// ── Shared handler: record a completed Stripe payment ──────────────────────────
async function recordStripePayment({ amount, currency, providerRef, metadata, booking_id, invoice_id }) {
  return transaction(async (client) => {
    const { rows: paymentRows } = await client.query(`
      INSERT INTO payments (booking_id, invoice_id, amount, currency, method, status, provider_ref, metadata)
      VALUES ($1,$2,$3,$4,'stripe','completed',$5,$6) RETURNING *
    `, [
      booking_id || null,
      invoice_id || null,
      amount,
      currency.toUpperCase(),
      providerRef,
      JSON.stringify(metadata || {}),
    ]);

    if (booking_id) {
      await client.query(
        `UPDATE bookings SET payment_status=CASE WHEN amount_paid+$1>=amount_total THEN 'paid' ELSE 'deposit_paid' END,
         amount_paid=amount_paid+$1 WHERE id=$2`,
        [amount, booking_id]
      );
    }

    if (invoice_id) {
      await client.query(
        `UPDATE invoices SET amount_paid=amount_paid+$1,
         status=CASE WHEN amount_paid+$1>=total THEN 'paid' ELSE status END,
         paid_at=CASE WHEN amount_paid+$1>=total THEN NOW() ELSE paid_at END
         WHERE id=$2`,
        [amount, invoice_id]
      );
    }

    return paymentRows[0];
  });
}

// ── payment_intent.succeeded (used by /stripe/intent custom checkout) ──────────
async function handleStripePaymentSuccess(paymentIntent) {
  const { booking_id, invoice_id, client_email, client_name } = paymentIntent.metadata || {};
  try {
    const payment = await recordStripePayment({
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency,
      providerRef: paymentIntent.id,
      metadata: paymentIntent,
      booking_id,
      invoice_id,
    });

    if (client_email && client_name) {
      const mockClient = { email: client_email, first_name: client_name.split(' ')[0] || client_name };
      emailService.sendPaymentReceived(payment, mockClient).catch(console.error);
      emailService.sendPaymentNotificationToOwner(payment, mockClient).catch(console.error);
      smsService.notifyOwnerPayment(payment.amount, client_name, 'Stripe').catch(console.error);
    }
  } catch (err) {
    console.error('[handleStripePaymentSuccess]', err);
  }
}

// ── checkout.session.completed (used by Stripe Payment Links) ──────────────────
async function handleCheckoutSessionCompleted(session, stripe) {
  try {
    const { booking_id, invoice_id, client_email, client_name } = session.metadata || {};

    let amount = session.amount_total != null ? session.amount_total / 100 : null;
    const currency = session.currency || 'gbp';
    let providerRef = session.payment_intent || session.id;

    // If a payment intent exists, prefer its amount/id for accuracy
    if (session.payment_intent) {
      try {
        const intent = await stripe.paymentIntents.retrieve(session.payment_intent);
        amount = intent.amount / 100;
        providerRef = intent.id;
      } catch (e) { /* fall back to session amount */ }
    }

    const payment = await recordStripePayment({
      amount,
      currency,
      providerRef,
      metadata: session,
      booking_id,
      invoice_id,
    });

    const email = client_email || session.customer_details?.email;
    const name  = client_name  || session.customer_details?.name || 'Client';

    if (email) {
      const mockClient = { email, first_name: name.split(' ')[0] || name };
      emailService.sendPaymentReceived(payment, mockClient).catch(console.error);
      emailService.sendPaymentNotificationToOwner(payment, mockClient).catch(console.error);
      smsService.notifyOwnerPayment(payment.amount, name, 'Stripe').catch(console.error);
    }
  } catch (err) {
    console.error('[handleCheckoutSessionCompleted]', err);
  }
}

// ── POST /payments/stripe/intent — Create payment intent (custom checkout) ─────
router.post('/stripe/intent', async (req, res) => {
  const { amount, currency = 'gbp', booking_id, invoice_id, client_name, client_email } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount.' });

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // convert to pence
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: { booking_id, invoice_id, client_name, client_email },
    });
    res.json({ clientSecret: intent.client_secret });
  } catch (err) {
    console.error('[POST /payments/stripe/intent]', err);
    res.status(500).json({ error: 'Failed to create payment. Please try again.' });
  }
});

// ── POST /payments/stripe/checkout-link — Create a Stripe Checkout payment link ─
router.post('/stripe/checkout-link', requireAdmin, async (req, res) => {
  const { amount, currency = 'gbp', description, booking_id, invoice_id, client_name, client_email, success_url, cancel_url } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount.' });

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency,
          product_data: { name: description || 'Bigg Shots Media — Payment' },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      customer_email: client_email || undefined,
      metadata: { booking_id, invoice_id, client_name, client_email },
      success_url: success_url || `${process.env.SITE_URL}/payment-success`,
      cancel_url: cancel_url || `${process.env.SITE_URL}/payment-cancelled`,
    });
    res.json({ success: true, url: session.url, id: session.id });
  } catch (err) {
    console.error('[POST /payments/stripe/checkout-link]', err);
    res.status(500).json({ error: 'Failed to create payment link.' });
  }
});

// ── POST /payments/bank-transfer — Record manual bank payment ──────────────────
router.post('/bank-transfer', requireAdmin, async (req, res) => {
  const { booking_id, invoice_id, amount, reference } = req.body;
  if (!amount) return res.status(400).json({ error: 'Amount is required.' });

  try {
    await transaction(async (client) => {
      await client.query(`
        INSERT INTO payments (booking_id, invoice_id, amount, currency, method, status, provider_ref)
        VALUES ($1,$2,$3,'GBP','bank_transfer','completed',$4)
      `, [booking_id || null, invoice_id || null, amount, reference || 'BANK_TRANSFER']);

      if (booking_id) {
        await client.query(
          `UPDATE bookings SET payment_status=CASE WHEN amount_paid+$1>=amount_total THEN 'paid' ELSE 'deposit_paid' END, amount_paid=amount_paid+$1 WHERE id=$2`,
          [amount, booking_id]
        );
      }
      if (invoice_id) {
        await client.query(
          `UPDATE invoices SET amount_paid=amount_paid+$1, status=CASE WHEN amount_paid+$1>=total THEN 'paid' ELSE status END, paid_at=CASE WHEN amount_paid+$1>=total THEN NOW() ELSE paid_at END WHERE id=$2`,
          [amount, invoice_id]
        );
      }
    });

    smsService.notifyOwnerPayment(amount, 'Client', 'Bank Transfer').catch(console.error);
    res.json({ success: true, message: 'Bank transfer payment recorded.' });
  } catch (err) {
    console.error('[POST /payments/bank-transfer]', err);
    res.status(500).json({ error: 'Failed to record payment.' });
  }
});

// ── GET /payments — Admin: list all payments ────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT p.*, b.first_name, b.last_name, b.email
      FROM payments p
      LEFT JOIN bookings b ON b.id = p.booking_id
      ORDER BY p.created_at DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load payments.' });
  }
});

module.exports = router;
