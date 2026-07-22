'use strict';

/**
 * notify.js — Invio SMS / Email (Twilio + SendGrid).
 *
 * Le credenziali sono lette da env al momento della chiamata; se assenti
 * restituisce un errore gestito senza lanciare eccezioni (no-op sicuro se
 * le variabili TWILIO_ o SENDGRID_ non sono configurate in .env).
 *
 * Ported from Staging/src/lib/notify.js senza modifiche.
 */

async function sendSMS(phone, message) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return { success: false, error: 'SMS service not configured' };
  }

  try {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone
    });

    return { success: true, message: 'SMS inviato con successo!' };
  } catch (error) {
    console.error('SMS error:', error.message);
    return { success: false, error: error.message };
  }
}

async function sendEmail(to, subject, message) {
  if (!process.env.SENDGRID_API_KEY) {
    return { success: false, error: 'Email service not configured' };
  }

  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    await sgMail.send({
      to,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject,
      text: message
    });

    return { success: true, message: 'Email inviata con successo!' };
  } catch (error) {
    console.error('Email error:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { sendSMS, sendEmail };
