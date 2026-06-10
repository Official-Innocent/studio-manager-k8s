'use strict';
const { generateTasks } = require('./taskService');
const {query} = require('./config/database');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 587, secure: false,
  auth: {user: 'thephotographerltd@gmail.com', pass: 'pymy olhw nkca bhms'},
  tls: {rejectUnauthorized: false}
});

const OWNER_EMAIL = 'hello@biggshotsmedia.com';

async function sendEmail(to, subject, bodyText, clientId, emailType) {
  const rows = bodyText.split('\n').map(function(l){ return l ? '<p style="margin:0 0 0.8rem;">'+l+'</p>' : '<br>'; }).join('');
  const html = '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0A0A0A;color:#F5F0E8;"><div style="background:#111;padding:2rem;text-align:center;"><h1 style="color:#C9A84C;font-weight:300;margin:0;">BIGG SHOTS MEDIA</h1></div><div style="padding:2rem;">'+rows+'</div><div style="padding:1rem 2rem;border-top:0.5px solid rgba(201,168,76,0.2);font-size:11px;color:#666;text-align:center;">biggshotsmedia.com</div></div>';
  await transporter.sendMail({from:'Bigg Shots Media <thephotographerltd@gmail.com>',replyTo:'hello@biggshotsmedia.com',to:to,subject:subject,html:html});
  if (clientId) {
    await query('INSERT INTO email_log(client_id,subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6,$7)',[clientId,subject,bodyText,to,'thephotographerltd@gmail.com',emailType,'outbound']);
  }
  console.log('[scheduler] sent',emailType,'to',to);
}

async function sendOwnerEmail(subject, bodyText) {
  const rows = bodyText.split('\n').map(function(l){ return l ? '<p style="margin:0 0 0.8rem;">'+l+'</p>' : '<br>'; }).join('');
  const html = '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0A0A0A;color:#F5F0E8;"><div style="background:#111;padding:2rem;text-align:center;"><h1 style="color:#C9A84C;font-weight:300;margin:0;">BIGG SHOTS MEDIA</h1><p style="color:#888;font-size:12px;margin:4px 0 0;">Owner Notification</p></div><div style="padding:2rem;">'+rows+'</div><div style="padding:1rem 2rem;border-top:0.5px solid rgba(201,168,76,0.2);font-size:11px;color:#666;text-align:center;">biggshotsmedia.com</div></div>';
  await transporter.sendMail({from:'Bigg Shots Media <thephotographerltd@gmail.com>',to:OWNER_EMAIL,subject:subject,html:html});
  console.log('[scheduler] owner notification sent:',subject);
}

async function alreadySentToday(clientId, emailType) {
  const r = await query("SELECT id FROM email_log WHERE client_id=$1 AND email_type=$2 AND created_at > NOW() - INTERVAL '20 hours'",[clientId,emailType]);
  return r.rows.length > 0;
}

async function alreadySentOwnerToday(emailType) {
  const r = await query("SELECT id FROM email_log WHERE email_type=$1 AND created_at > NOW() - INTERVAL '20 hours'",[emailType]);
  return r.rows.length > 0;
}

async function runPaymentReminders() {
  const r = await query("SELECT pi.*, c.first_name, c.email, c.id as client_id FROM payment_installments pi JOIN clients c ON c.id = pi.client_id WHERE pi.status NOT IN ('paid','cancelled','waived') AND pi.due_date IS NOT NULL AND c.marketing_consent = true AND (pi.arrangement_agreed IS NULL OR pi.arrangement_agreed = false)");
  const today = new Date(); today.setHours(0,0,0,0);
  for (var i=0; i<r.rows.length; i++) {
    var p = r.rows[i];
    var due = new Date(p.due_date); due.setHours(0,0,0,0);
    var diffDays = Math.round((due - today) / 86400000);
    var amt = '£' + parseFloat(p.amount || 0).toFixed(2);
    var name = p.first_name || 'there';
    var label = p.label || 'Payment';
    if (diffDays === 7 && !p.reminder_sent_7d) {
      await sendEmail(p.email,'Payment coming up - Bigg Shots Media','Dear '+name+',\n\nJust a friendly reminder that your '+label+' of '+amt+' is due in 7 days.\n\nPlease ensure funds are ready.\n\nWarm regards,\nInnocent\nBigg Shots Media',p.client_id,'payment_reminder_7d');
      await query('UPDATE payment_installments SET reminder_sent_7d=true WHERE id=$1',[p.id]);
    } else if (diffDays === 3) {
      var sent3 = await alreadySentToday(p.client_id,'payment_reminder_3d_'+p.id);
      if (!sent3) await sendEmail(p.email,'Payment due in 3 days - Bigg Shots Media','Dear '+name+',\n\nYour '+label+' of '+amt+' is due in 3 days.\n\nPlease arrange payment at your earliest convenience.\n\nWarm regards,\nInnocent\nBigg Shots Media',p.client_id,'payment_reminder_3d_'+p.id);
    } else if (diffDays === 1 && !p.reminder_sent_1d) {
      await sendEmail(p.email,'Payment due tomorrow - Bigg Shots Media','Dear '+name+',\n\nYour '+label+' of '+amt+' is due tomorrow.\n\nPlease ensure this is arranged today.\n\nWarm regards,\nInnocent\nBigg Shots Media',p.client_id,'payment_reminder_1d');
      await query('UPDATE payment_installments SET reminder_sent_1d=true WHERE id=$1',[p.id]);
    } else if (diffDays === 0) {
      var sent0 = await alreadySentToday(p.client_id,'payment_due_today_'+p.id);
      if (!sent0) await sendEmail(p.email,'Payment due today - Bigg Shots Media','Dear '+name+',\n\nYour '+label+' of '+amt+' is due today.\n\nPlease arrange payment as soon as possible.\n\nWarm regards,\nInnocent\nBigg Shots Media',p.client_id,'payment_due_today_'+p.id);
    } else if (diffDays < 0) {
      var daysOver = Math.abs(diffDays);
      if (daysOver === 1 || daysOver % 2 === 0) {
        var sentOver = await alreadySentToday(p.client_id,'payment_overdue_'+p.id+'_'+daysOver);
        if (!sentOver) {
          if (daysOver === 14) {
          var sent14 = await alreadySentToday(p.client_id,'payment_final_notice_'+p.id);
          if (!sent14) {
            await sendEmail(p.email,'Final Notice: Payment overdue - Bigg Shots Media','Dear '+name+',\n\nThis is a final notice regarding your outstanding '+label+' of '+amt+', which is now 14 days overdue.\n\nPlease make payment immediately or contact us at hello@biggshotsmedia.com.\n\nWarm regards,\nInnocent\nBigg Shots Media',p.client_id,'payment_final_notice_'+p.id);
          }
        }
        var urgency = daysOver >= 7 ? 'Urgent: ' : '';
          var overdueMsg = daysOver >= 7 ? 'This is an urgent matter. Please contact us immediately at hello@biggshotsmedia.com.' : 'Please arrange payment urgently or contact us to discuss your options.';
          await sendEmail(p.email,urgency+'Payment overdue ('+daysOver+' day'+(daysOver===1?'':'s')+') - Bigg Shots Media','Dear '+name+',\n\nYour '+label+' of '+amt+' is now '+daysOver+' day'+(daysOver===1?'':'s')+' overdue.\n\n'+overdueMsg+'\n\nWarm regards,\nInnocent\nBigg Shots Media',p.client_id,'payment_overdue_'+p.id+'_'+daysOver);
        }
      }
    }
  }
}

async function runSessionReminders() {
  const r = await query("SELECT b.*, c.first_name, c.last_name, c.email, c.marketing_consent, c.id as client_id FROM bookings b JOIN clients c ON c.id = b.client_id WHERE b.status IN ('confirmed','pending') AND b.session_date IS NOT NULL AND b.session_date > NOW()");
  const today = new Date(); today.setHours(0,0,0,0);
  for (var i=0; i<r.rows.length; i++) {
    var b = r.rows[i];
    var session = new Date(b.session_date); session.setHours(0,0,0,0);
    var diffDays = Math.round((session - today) / 86400000);
    var name = b.first_name || 'there';
    var fullName = (b.first_name + ' ' + b.last_name).trim();
    var sessionType = b.session_type || 'session';
    var isWedding = sessionType.toLowerCase().includes('wedding');
    var isMaternity = sessionType.toLowerCase().includes('maternity');
    var dateStr = new Date(b.session_date).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    var adminLink = 'https://biggshotsmedia.com/admin#projects/'+b.id;

    if (isWedding) {
      if (diffDays === 30) {
        var o30 = await alreadySentOwnerToday('owner_wedding_30d_'+b.id);
        if (!o30) { await sendOwnerEmail('Wedding in 4 weeks — '+fullName+' ('+dateStr+')','Wedding coming up in 30 days.\n\nClient: '+fullName+'\nDate: '+dateStr+'\nLocation: '+(b.location||'TBC')+'\n\nCheck: shot list, travel, equipment.\n\nAdmin: '+adminLink); await query("INSERT INTO email_log(subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6)",['owner_wedding_30d '+b.id,'',OWNER_EMAIL,'thephotographerltd@gmail.com','owner_wedding_30d_'+b.id,'outbound']); }
      }
      if (diffDays === 14) {
        var o14 = await alreadySentOwnerToday('owner_wedding_14d_'+b.id);
        if (!o14) { await sendOwnerEmail('Wedding in 2 weeks — '+fullName+' ('+dateStr+')','Wedding is 2 weeks away.\n\nClient: '+fullName+'\nDate: '+dateStr+'\nLocation: '+(b.location||'TBC')+'\n\nFinal checks: equipment, contract, timeline.\n\nAdmin: '+adminLink); await query("INSERT INTO email_log(subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6)",['owner_wedding_14d '+b.id,'',OWNER_EMAIL,'thephotographerltd@gmail.com','owner_wedding_14d_'+b.id,'outbound']); }
      }
      if (diffDays === 2) {
        var o48w = await alreadySentOwnerToday('owner_wedding_48h_'+b.id);
        if (!o48w) { await sendOwnerEmail('Wedding day after tomorrow — '+fullName,'Wedding in 48 hours.\n\nClient: '+fullName+'\nDate: '+dateStr+'\nLocation: '+(b.location||'TBC')+'\n\nCheck: batteries, cards, backup camera.\n\nAdmin: '+adminLink); await query("INSERT INTO email_log(subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6)",['owner_wedding_48h '+b.id,'',OWNER_EMAIL,'thephotographerltd@gmail.com','owner_wedding_48h_'+b.id,'outbound']); }
      }
      if (diffDays === 1) {
        var o24w = await alreadySentOwnerToday('owner_wedding_24h_'+b.id);
        if (!o24w) { await sendOwnerEmail('Wedding tomorrow — '+fullName+" — you're ready",'Wedding day is tomorrow.\n\nClient: '+fullName+'\nDate: '+dateStr+'\nLocation: '+(b.location||'TBC')+'\n\nGet an early night. You have got this.\n\nAdmin: '+adminLink); await query("INSERT INTO email_log(subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6)",['owner_wedding_24h '+b.id,'',OWNER_EMAIL,'thephotographerltd@gmail.com','owner_wedding_24h_'+b.id,'outbound']); }
      }
      if (b.marketing_consent && diffDays === 7) {
        var sw7 = await alreadySentToday(b.client_id,'wedding_excitement_7d');
        if (!sw7) await sendEmail(b.email,'One week to go — Bigg Shots Media','Dear '+name+',\n\nOne week today and it is your wedding day. I hope the excitement is building!\n\nI have been preparing and I cannot wait to be there with you to capture every moment — the quiet ones, the big ones, and everything in between.\n\nIf there is anything you would like me to know before the day — special moments, people, details that matter to you — please do not hesitate to get in touch.\n\nEnjoy this final week. It is a beautiful time.\n\nWith warmth,\nInnocent\nBigg Shots Media',b.client_id,'wedding_excitement_7d');
      }
    } else if (isMaternity) {
      if (diffDays === 7) {
        var o7m = await alreadySentOwnerToday('owner_shoot_7d_'+b.id);
        if (!o7m) { await sendOwnerEmail('Maternity session in 1 week — '+fullName,'Client: '+fullName+'\nDate: '+dateStr+'\nLocation: '+(b.location||'TBC')+'\n\nAdmin: '+adminLink); await query("INSERT INTO email_log(subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6)",['owner_shoot_7d '+b.id,'',OWNER_EMAIL,'thephotographerltd@gmail.com','owner_shoot_7d_'+b.id,'outbound']); }
      }
      if (diffDays === 2) {
        var o48m = await alreadySentOwnerToday('owner_shoot_48h_'+b.id);
        if (!o48m) { await sendOwnerEmail('Maternity session in 48hrs — '+fullName,'Client: '+fullName+'\nDate: '+dateStr+'\nLocation: '+(b.location||'TBC')+'\n\nAdmin: '+adminLink); await query("INSERT INTO email_log(subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6)",['owner_shoot_48h '+b.id,'',OWNER_EMAIL,'thephotographerltd@gmail.com','owner_shoot_48h_'+b.id,'outbound']); }
      }
      if (diffDays === 1) {
        var o24m = await alreadySentOwnerToday('owner_shoot_24h_'+b.id);
        if (!o24m) { await sendOwnerEmail('Maternity session tomorrow — '+fullName,'Client: '+fullName+'\nDate: '+dateStr+'\nLocation: '+(b.location||'TBC')+'\n\nAdmin: '+adminLink); await query("INSERT INTO email_log(subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6)",['owner_shoot_24h '+b.id,'',OWNER_EMAIL,'thephotographerltd@gmail.com','owner_shoot_24h_'+b.id,'outbound']); }
      }
      if (b.marketing_consent) {
        if (diffDays === 7) {
          var sm7 = await alreadySentToday(b.client_id,'maternity_prep_7d');
          if (!sm7) await sendEmail(b.email,'Your maternity session is one week away — Bigg Shots Media','Dear '+name+',\n\nYour maternity session is just one week away and I am so looking forward to spending this time with you.\n\nA few gentle things to keep in mind:\n\n- Wear something that feels comfortable and makes you feel beautiful — flowing fabrics work wonderfully\n- You are welcome to bring your partner, children, or anyone who makes you feel at ease\n- The session is completely at your pace — there is no rush, and we will take as many breaks as you need\n- Hydrate well in the days leading up to the shoot\n\nMost importantly — you do not need to do anything except show up. I will take care of everything else.\n\nThis is a celebration of you and the incredible journey you are on. I cannot wait to capture it.\n\nWith warmth,\nInnocent\nBigg Shots Media',b.client_id,'maternity_prep_7d');
        }
        if (diffDays === 2) {
          var sm48 = await alreadySentToday(b.client_id,'maternity_excitement_48h');
          if (!sm48) await sendEmail(b.email,'Almost time — see you soon — Bigg Shots Media','Dear '+name+',\n\nYour session is just two days away and I have been looking forward to this.\n\nI just want you to know — however you are feeling on the day is absolutely perfect. Whether you are glowing with energy or just quietly present, I will work with you and around you.\n\nI will have water ready, the space will be warm and comfortable, and there is no timeline pressure whatsoever. We go at your pace, full stop.\n\nThese photographs are going to mean everything to you one day. I feel privileged to be the one taking them.\n\nSee you very soon.\n\nWith love,\nInnocent\nBigg Shots Media',b.client_id,'maternity_excitement_48h');
        }
        if (diffDays === 0) {
          var sm0 = await alreadySentToday(b.client_id,'maternity_morning_of');
          if (!sm0) await sendEmail(b.email,'Today is the day — Bigg Shots Media','Dear '+name+',\n\nToday is the day and I am so excited.\n\nTake your time getting ready — there is no rush. Arrive when you feel ready and we will go from there.\n\nI am so honoured to be capturing this chapter of your life.\n\nSee you soon.\n\nWith warmth,\nInnocent\nBigg Shots Media',b.client_id,'maternity_morning_of');
        }
      }
    } else {
      if (diffDays === 7) {
        var o7s = await alreadySentOwnerToday('owner_shoot_7d_'+b.id);
        if (!o7s) { await sendOwnerEmail('Upcoming '+sessionType+' in 1 week — '+fullName,'Client: '+fullName+'\nDate: '+dateStr+'\nLocation: '+(b.location||'TBC')+'\n\nAdmin: '+adminLink); await query("INSERT INTO email_log(subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6)",['owner_shoot_7d '+b.id,'',OWNER_EMAIL,'thephotographerltd@gmail.com','owner_shoot_7d_'+b.id,'outbound']); }
      }
      if (diffDays === 2) {
        var o48s = await alreadySentOwnerToday('owner_shoot_48h_'+b.id);
        if (!o48s) { await sendOwnerEmail('Shoot in 48hrs — '+fullName+' ('+sessionType+')','Client: '+fullName+'\nDate: '+dateStr+'\nLocation: '+(b.location||'TBC')+'\n\nAdmin: '+adminLink); await query("INSERT INTO email_log(subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6)",['owner_shoot_48h '+b.id,'',OWNER_EMAIL,'thephotographerltd@gmail.com','owner_shoot_48h_'+b.id,'outbound']); }
      }
      if (diffDays === 1) {
        var o24s = await alreadySentOwnerToday('owner_shoot_24h_'+b.id);
        if (!o24s) { await sendOwnerEmail('Shoot tomorrow — '+fullName+' ('+sessionType+')','Client: '+fullName+'\nDate: '+dateStr+'\nLocation: '+(b.location||'TBC')+'\n\nAdmin: '+adminLink); await query("INSERT INTO email_log(subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6)",['owner_shoot_24h '+b.id,'',OWNER_EMAIL,'thephotographerltd@gmail.com','owner_shoot_24h_'+b.id,'outbound']); }
      }
      if (b.marketing_consent && diffDays === 2) {
        var ss48 = await alreadySentToday(b.client_id,'session_excitement_48h');
        if (!ss48) await sendEmail(b.email,'Your session is almost here — Bigg Shots Media','Dear '+name+',\n\nYour '+sessionType+' session is just two days away and I have genuinely been looking forward to this.\n\nAll you need to do is show up as yourself — I will handle the rest. We will have a great time and create something you will treasure.\n\nA couple of things that always help:\n- Wear something that makes you feel like you\n- Get a good night\'s sleep\n- Arrive relaxed — we are in no rush\n\nI am so excited to work with you. See you soon.\n\nWith warmth,\nInnocent\nBigg Shots Media',b.client_id,'session_excitement_48h');
      }
    }
  }
}

async function runEditingUpdates() {
  const r = await query("SELECT b.*, c.first_name, c.email, c.id as client_id FROM bookings b JOIN clients c ON c.id = b.client_id WHERE b.status = 'completed' AND b.session_date IS NOT NULL AND c.marketing_consent = true");
  const today = new Date(); today.setHours(0,0,0,0);
  for (var i=0; i<r.rows.length; i++) {
    var b = r.rows[i];
    var session = new Date(b.session_date); session.setHours(0,0,0,0);
    var daysSince = Math.round((today - session) / 86400000);
    var name = b.first_name || 'there';
    var isWedding = (b.session_type||'').toLowerCase().includes('wedding');
    var halfwayDay = isWedding ? 11 : 7;
    if (daysSince === halfwayDay) {
      var sent = await alreadySentToday(b.client_id,'editing_update');
      if (!sent) await sendEmail(b.email,'We are working on your photos — Bigg Shots Media','Dear '+name+',\n\nJust a little update — we are hard at work editing your photographs and they are looking beautiful.\n\nYou will receive a notification as soon as your gallery is ready.\n\nThank you for your patience!\n\nWith warmth,\nInnocent\nBigg Shots Media',b.client_id,'editing_update');
    }
  }
}

async function runQuestionnaireReminders() {
  const r = await query("SELECT q.*, c.first_name, c.email, c.id as client_id FROM questionnaires q JOIN clients c ON c.id = q.client_id WHERE q.status = 'sent' AND q.created_at > NOW() - INTERVAL '7 days' AND c.marketing_consent = true");
  for (var i=0; i<r.rows.length; i++) {
    var q = r.rows[i];
    var name = q.first_name || 'there';
    var sent = await alreadySentToday(q.client_id,'questionnaire_reminder');
    if (!sent) await sendEmail(q.email,'Please complete your pre-shoot questionnaire — Bigg Shots Media','Dear '+name+',\n\nYour pre-shoot questionnaire is waiting in your client portal.\n\nTaking a few minutes to fill it in helps us prepare and make your session perfect.\n\nPortal: https://biggshotsmedia.com/portal\n\nWarm regards,\nInnocent\nBigg Shots Media',q.client_id,'questionnaire_reminder');
  }
}


async function sendDailyBriefing() {
  try {

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: {user: 'thephotographerltd@gmail.com', pass: 'pymy olhw nkca bhms'},
      tls: {rejectUnauthorized: false}
    });

    const { rows: tasks } = await query(`
      SELECT t.*, c.first_name, c.last_name
      FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
      WHERE t.status = 'open'
      ORDER BY CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.created_at ASC
    `);

    const { rows: upcoming } = await query(`
      SELECT b.*, c.first_name, c.last_name
      FROM bookings b JOIN clients c ON c.id = b.client_id
      WHERE b.status = 'confirmed' AND b.session_date >= CURRENT_DATE AND b.session_date <= CURRENT_DATE + INTERVAL '14 days'
      ORDER BY b.session_date ASC
    `);

    if (!tasks.length && !upcoming.length) {
      console.log('[briefing] nothing to report today');
      return;
    }

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long', year:'numeric'});

    const high = tasks.filter(t => t.priority === 'high');
    const medium = tasks.filter(t => t.priority === 'medium');
    const low = tasks.filter(t => t.priority === 'low');

    function taskRow(t) {
      var name = t.first_name ? t.first_name + ' ' + t.last_name : '';
      return '<tr><td style="padding:8px 12px;border-bottom:0.5px solid #222;font-size:13px;color:#F5F0E8;">' + t.title + '</td><td style="padding:8px 12px;border-bottom:0.5px solid #222;font-size:12px;color:#888;">' + (t.description||'') + '</td></tr>';
    }

    function section(label, color, items) {
      if (!items.length) return '';
      return '<div style="margin-bottom:1.5rem;"><div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:'+color+';margin-bottom:0.5rem;font-weight:600;">'+label+' ('+items.length+')</div><table style="width:100%;border-collapse:collapse;background:#111;border:0.5px solid #333;">'+items.map(taskRow).join('')+'</table></div>';
    }

    var upcomingRows = upcoming.map(function(b) {
      var today2 = new Date(); today2.setHours(0,0,0,0);
      var sessionDay = new Date(b.session_date); sessionDay.setHours(0,0,0,0);
      var daysTo = Math.round((sessionDay - today2) / 86400000);
      var daysLabel = daysTo === 0 ? 'TODAY' : daysTo === 1 ? 'Tomorrow' : 'In ' + daysTo + ' days';
      return '<tr><td style="padding:8px 12px;border-bottom:0.5px solid #222;font-size:13px;color:#F5F0E8;">'+b.first_name+' '+b.last_name+'</td><td style="padding:8px 12px;border-bottom:0.5px solid #222;font-size:12px;color:#888;">'+b.session_type+'</td><td style="padding:8px 12px;border-bottom:0.5px solid #222;font-size:12px;color:#C9A84C;">'+daysLabel+'</td></tr>';
    }).join('');

    var html = '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#0A0A0A;color:#F5F0E8;">'
      + '<div style="background:#111;padding:2rem;text-align:center;"><h1 style="color:#C9A84C;font-weight:300;margin:0;letter-spacing:0.15em;">BIGG SHOTS MEDIA</h1><p style="color:#666;font-size:12px;margin:4px 0 0;">Daily Briefing</p></div>'
      + '<div style="padding:2rem;">'
      + '<p style="color:#C9A84C;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 1.5rem;">'+dateStr+'</p>'
      + '<p style="font-size:16px;color:#F5F0E8;margin:0 0 1.5rem;">Good morning, Innocent 👋</p>'
      + section('🔴 Urgent', '#E05555', high)
      + section('🟡 Needs attention', '#C9A84C', medium)
      + section('🔵 Low priority', '#6699CC', low)
      + (upcoming.length ? '<div style="margin-bottom:1.5rem;"><div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#C9A84C;margin-bottom:0.5rem;font-weight:600;">📅 Upcoming jobs (14 days)</div><table style="width:100%;border-collapse:collapse;background:#111;border:0.5px solid #333;">'+upcomingRows+'</table></div>' : '')
      + '<div style="margin-top:2rem;text-align:center;"><a href="https://biggshotsmedia.com/admin" style="display:inline-block;background:#C9A84C;color:#1a1200;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:0.8rem 2rem;text-decoration:none;">Open Admin</a></div>'
      + '</div>'
      + '<div style="padding:1rem 2rem;border-top:0.5px solid rgba(201,168,76,0.2);font-size:11px;color:#666;text-align:center;">biggshotsmedia.com</div>'
      + '</div>';

    await transporter.sendMail({
      from: 'Bigg Shots Media <thephotographerltd@gmail.com>',
      to: 'hello@biggshotsmedia.com',
      subject: '📋 Daily Briefing — ' + dateStr,
      html: html
    });
    console.log('[briefing] daily briefing sent');
  } catch(e) {
    console.error('[briefing] error:', e.message);
  }
}


async function runGalleryExpiryWarnings() {
  const r = await query(`
    SELECT g.id, g.title, g.expires_at, g.slug,
           c.first_name, c.email, c.id as client_id, c.marketing_consent
    FROM galleries g
    JOIN clients c ON c.id = g.client_id
    WHERE g.expires_at IS NOT NULL
      AND g.expires_at > NOW()
      AND g.expires_at <= NOW() + INTERVAL '7 days'
      AND c.marketing_consent = true
  `);
  for (var i = 0; i < r.rows.length; i++) {
    var g = r.rows[i];
    var daysLeft = Math.round((new Date(g.expires_at) - new Date()) / 86400000);
    var sent = await alreadySentToday(g.client_id, 'gallery_expiry_warning_' + g.id);
    if (!sent) {
      var name = g.first_name || 'there';
      var galleryUrl = 'https://biggshotsmedia.com/portal';
      await sendEmail(
        g.email,
        'Your gallery expires in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' — Bigg Shots Media',
        'Dear ' + name + ',\n\nJust a reminder that your Bigg Shots Media gallery will expire in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + '.\n\nPlease log in to your client portal to download your photos before they become unavailable.\n\nPortal: ' + galleryUrl + '\n\nIf you need more time or have any issues, please contact us at hello@biggshotsmedia.com.\n\nWarm regards,\nInnocent\nBigg Shots Media',
        g.client_id,
        'gallery_expiry_warning_' + g.id
      );
      console.log('[scheduler] gallery expiry warning sent to', g.email, '- expires in', daysLeft, 'days');
    }
  }
}


async function runPrepChecklists() {
  const r = await query(`
    SELECT b.*, c.first_name, c.last_name, c.id as client_id,
      (SELECT COUNT(*) FROM contracts co WHERE co.client_id = c.id AND co.status = 'signed') as contracts_signed,
      (SELECT COUNT(*) FROM questionnaires q WHERE q.client_id = c.id AND q.status = 'completed') as questionnaires_done,
      (SELECT COUNT(*) FROM payment_installments pi WHERE pi.client_id = c.id AND pi.status = 'paid') as installments_paid,
      (SELECT COUNT(*) FROM payment_installments pi2 WHERE pi2.client_id = c.id AND pi2.status != 'paid' AND pi2.status != 'cancelled') as installments_pending
    FROM bookings b
    JOIN clients c ON c.id = b.client_id
    WHERE b.status = 'confirmed'
    AND b.session_date IS NOT NULL
    AND b.session_date = CURRENT_DATE + INTERVAL '7 days'
  `);

  for (var i = 0; i < r.rows.length; i++) {
    var b = r.rows[i];
    var isWedding = (b.session_type || '').toLowerCase().includes('wedding');
    var isMaternity = (b.session_type || '').toLowerCase().includes('maternity');
    var fullName = (b.first_name + ' ' + b.last_name).trim();
    var dateStr = new Date(b.session_date).toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long'});
    var adminLink = 'https://biggshotsmedia.com/admin';

    // Build checklist items
    var checklist = [];
    checklist.push(b.contract_signed ? '✅ Contract signed' : '❌ Contract NOT signed — chase client');
    checklist.push(b.questionnaires_done > 0 ? '✅ Pre-shoot questionnaire completed' : '⚠️ Questionnaire not completed — send reminder');
    checklist.push(b.installments_pending === 0 ? '✅ All payments up to date' : '⚠️ ' + b.installments_pending + ' payment(s) outstanding');
    checklist.push(b.location ? '✅ Location confirmed: ' + b.location : '⚠️ Location not set — confirm with client');

    if (isWedding) {
      checklist.push('📋 Confirm ceremony & reception times with client');
      checklist.push('📋 Check shot list / key people to photograph');
      checklist.push('📋 Scout venue or confirm travel route');
      checklist.push('📋 Check second shooter arrangements');
      checklist.push('📋 Charge all batteries — primary + backup cameras');
      checklist.push('📋 Format memory cards — bring spares');
      checklist.push('📋 Pack lighting equipment');
      checklist.push('📋 Confirm start time and parking');
    } else if (isMaternity) {
      checklist.push('📋 Confirm studio/location setup — comfortable temperature');
      checklist.push('📋 Prepare props and fabric selections');
      checklist.push('📋 Have water and snacks available');
      checklist.push('📋 Charge batteries and format cards');
      checklist.push('📋 Confirm if partner/children are joining');
    } else {
      checklist.push('📋 Confirm session time and location with client');
      checklist.push('📋 Charge batteries and format memory cards');
      checklist.push('📋 Check lens selection for session type');
      checklist.push('📋 Pack reflector/lighting if needed');
    }

    var checklistText = checklist.join('\n');
    var taskTitle = '📸 Shoot in 7 days — ' + fullName + ' (' + b.session_type + ')';
    var taskDesc = dateStr + (b.location ? ' · ' + b.location : '') + '\n' + checklistText;

    // Create task
    var existing = await query("SELECT id FROM tasks WHERE type='prep_checklist' AND booking_id=$1 AND status='open'", [b.id]);
    if (!existing.rows.length) {
      await query(
        'INSERT INTO tasks(type,title,description,priority,status,client_id,booking_id,due_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        ['prep_checklist', taskTitle, taskDesc, 'high', 'open', b.client_id, b.id, b.session_date]
      );
    }

    // Send owner email
    var sent = await alreadySentOwnerToday('prep_checklist_' + b.id);
    if (!sent) {
      await sendOwnerEmail(
        '📸 Prep checklist — ' + fullName + ' in 7 days',
        'Your ' + b.session_type + ' shoot with ' + fullName + ' is in 7 days.\n\nDate: ' + dateStr + '\nLocation: ' + (b.location || 'TBC') + '\n\n' + checklistText + '\n\nAdmin: ' + adminLink
      );
      await query("INSERT INTO email_log(subject,body,to_email,from_email,email_type,direction) VALUES($1,$2,$3,$4,$5,$6)",
        ['Prep checklist ' + b.id, '', 'hello@biggshotsmedia.com', 'thephotographerltd@gmail.com', 'prep_checklist_' + b.id, 'outbound']);
    }
  }
}



async function runBalanceInvoices() {
  try {
    // Find completed bookings where session date has passed, deposit invoice exists, but no balance invoice yet
    const r = await query(`
      SELECT b.*, c.first_name, c.last_name, c.email, c.id as client_id,
             i.total, i.deposit_amt, i.payment_ref
      FROM bookings b
      JOIN clients c ON c.id = b.client_id
      JOIN invoices i ON i.booking_id = b.id AND i.invoice_type = 'deposit'
      WHERE b.status = 'completed'
        AND b.session_date < NOW()
        AND NOT EXISTS (
          SELECT 1 FROM invoices bi
          WHERE bi.booking_id = b.id AND bi.invoice_type = 'balance'
        )
    `);
    for (var i = 0; i < r.rows.length; i++) {
      var b = r.rows[i];
      var balanceAmt = parseFloat(b.total) - parseFloat(b.deposit_amt);
      if (balanceAmt <= 0) continue;
      var ref = 'BSM-' + b.id.split('-')[0].toUpperCase() + '-BAL';
      var dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 14);
      var invNum = 'INV-BAL-' + Date.now().toString().slice(-6);
      var sessionDateStr = new Date(b.session_date).toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'});
      // Create balance invoice
      await query(`
        INSERT INTO invoices (invoice_number, booking_id, client_id, client_name, client_email,
          line_items, subtotal, total, deposit_amt, due_date, status, invoice_type,
          bank_sort_code, bank_account, payment_ref, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,'sent','balance','60-83-71','63564979',$10,$11)
      `, [
        invNum, b.id, b.client_id,
        b.first_name + ' ' + b.last_name,
        b.email,
        JSON.stringify([{description: b.session_type + ' — Balance Payment', amount: balanceAmt}]),
        balanceAmt, balanceAmt,
        dueDate.toISOString().split('T')[0],
        ref,
        'Balance invoice for ' + b.session_type + ' on ' + sessionDateStr
      ]);
      // Send email to client
      var name = b.first_name || 'there';
      var body = 'Dear ' + name + ',\n\nThank you so much for having me capture your ' + b.session_type.toLowerCase() + '. It was a pleasure working with you.\n\nThe remaining amount of \u00a3' + balanceAmt.toFixed(2) + ' is due by ' + dueDate.toLocaleDateString("en-GB", {"day":"numeric","month":"long","year":"numeric"}) + '.\n\nBank Transfer:\nName: Innocent Obute\nSort Code: 60-83-71\nAccount: 63564979\nReference: ' + ref + '\n\nWith warmth,\nInnocent\nBigg Shots Media';
      await sendEmail(b.email, 'Your Balance Invoice — Bigg Shots Media', body, b.client_id, 'balance_invoice');
      await sendOwnerEmail('Balance invoice sent — ' + b.first_name + ' ' + b.last_name, 'Balance invoice sent to ' + b.email + '\n\nAmount: \u00a3' + balanceAmt.toFixed(2) + '\nDue: ' + dueDate.toLocaleDateString("en-GB") + '\nRef: ' + ref);
      console.log('[balance invoice] sent to', b.email, 'amount £' + balanceAmt.toFixed(2));
    }
  } catch(e) { console.error('[balance invoice] error:', e.message); }
}
async function runReviewRequests() {
  try {
    // Find galleries delivered 24hrs ago where review request not yet sent
    const r = await query(`
      SELECT g.id, g.delivered_at, g.slug, b.session_type,
             c.id as client_id, c.first_name, c.email, c.marketing_consent
      FROM galleries g
      JOIN clients c ON c.id = g.client_id
      LEFT JOIN bookings b ON b.client_id = c.id
      WHERE g.delivered_at IS NOT NULL
        AND g.delivered_at <= NOW() - INTERVAL '24 hours'
        AND g.delivered_at >= NOW() - INTERVAL '48 hours'
        AND c.marketing_consent = true
    `);
    for (var i = 0; i < r.rows.length; i++) {
      var g = r.rows[i];
      var name = g.first_name || 'there';
      var already = await alreadySentToday(g.client_id, 'review_request');
      if (already) continue;
      var reviewLink = 'https://biggshotsmedia.com'; // TODO: replace with GBP review link once set up
      var body = 'Dear ' + name + ',\n\nThank you so much for choosing Bigg Shots Media. It was a genuine pleasure working with you.\n\nYour gallery is ready and I hope you love the photos as much as I enjoyed taking them.\n\nIf you have a moment, I would be so grateful if you could leave a quick review — it makes an enormous difference to a small business:\n' + reviewLink + '\n\nIt takes less than a minute and means the world.\n\nWith warmth,\nInnocent\nBigg Shots Media';
      await sendEmail(g.email, 'Thank you — would you leave us a review? — Bigg Shots Media', body, g.client_id, 'review_request');
    }
  } catch(e) { console.error('[review request] error:', e.message); }
}

async function runUptimeCheck() {
  try {
    const https = require('https');
    const result = await new Promise(function(resolve) {
      const req = https.get('https://biggshotsmedia.com/api/health', { timeout: 10000 }, function(res) {
        resolve({ ok: res.statusCode === 200, status: res.statusCode });
      });
      req.on('error', function(e) { resolve({ ok: false, error: e.message }); });
      req.on('timeout', function() { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    });
    if (!result.ok) {
      console.error('[uptime] site DOWN:', result.error || result.status);
      await sendOwnerEmail(
        'ALERT: biggshotsmedia.com is DOWN',
        'Site health check failed at ' + new Date().toISOString() + '\nError: ' + (result.error || 'HTTP ' + result.status) + '\n\nCheck the server immediately.'
      );
    } else {
      console.log('[uptime] site OK');
    }
  } catch(e) { console.error('[uptime] check error:', e.message); }
}

async function runCalendarSync() {
  try {
    const gcal = require('./googleCalendar');
    const events = await gcal.getExternalEvents(180);
    let blocked = 0;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var dateStr = ev.start.date || (ev.start.dateTime ? ev.start.dateTime.split('T')[0] : null);
      if (!dateStr) continue;
      if (ev.description && ev.description.includes('BSM-')) continue;
      if (ev.organizer && ev.organizer.email && ev.organizer.email !== 'thephotographerltd@gmail.com' && ev.creator && ev.creator.email !== 'thephotographerltd@gmail.com') continue;
      await query('INSERT INTO blocked_dates (date, reason) VALUES ($1,$2) ON CONFLICT (date) DO UPDATE SET reason=$2', [dateStr, ev.summary || 'Google Calendar']);
      blocked++;
    }
    console.log('[calendar sync] blocked', blocked, 'dates');
  } catch(e) { console.error('[calendar sync] error:', e.message); }
}



async function runPromoReminders() {
  try {
    const { rows: promos } = await query(`
      SELECT * FROM promotions
      WHERE active = true
        AND ends_at IS NOT NULL
        AND last_broadcast_at IS NOT NULL
        AND ends_at > NOW()
        AND ends_at <= NOW() + INTERVAL '24 hours'
        AND reminder_sent = false
    `);
    for (var i = 0; i < promos.length; i++) {
      var promo = promos[i];
      var { rows: clients } = await query(
        'SELECT id, email, first_name FROM clients WHERE marketing_consent = true'
      );
      var sent = 0;
      for (var j = 0; j < clients.length; j++) {
        var client = clients[j];
        try {
          await sendEmail(client.email, 'Last chance — ' + promo.title + ' ends soon — Bigg Shots Media',
            'Dear ' + (client.first_name || 'there') + ',\n\nJust a reminder that our ' + promo.title + ' promotion ends very soon.\n\nDon\'t miss out!\n\nWith warmth,\nInnocent\nBigg Shots Media',
            client.id, 'promo_reminder_' + promo.id);
          sent++;
        } catch(e) { console.error('[promo reminder] failed for', client.email, e.message); }
      }
      await query('UPDATE promotions SET reminder_sent=true WHERE id=$1', [promo.id]);
      console.log('[promo reminder] sent to', sent, 'clients for promo', promo.id);
    }
  } catch(e) { console.error('[promo reminder] error:', e.message); }
}
async function runAll() {
  console.log("[scheduler] running at", new Date().toISOString());
  await runPaymentReminders().catch(function(e){ console.error("[scheduler] payment reminders error:", e.message); });
  await runSessionReminders().catch(function(e){ console.error("[scheduler] session reminders error:", e.message); });
  await runEditingUpdates().catch(function(e){ console.error("[scheduler] editing updates error:", e.message); });
  await runQuestionnaireReminders().catch(function(e){ console.error("[scheduler] questionnaire reminders error:", e.message); });
  await runPromoReminders().catch(function(e){ console.error("[scheduler] promo reminders error:", e.message); });
  await runGalleryExpiryWarnings().catch(function(e){ console.error("[scheduler] gallery expiry error:", e.message); });
  await runPrepChecklists().catch(function(e){ console.error("[scheduler] prep checklists error:", e.message); });
  await generateTasks().catch(function(e){ console.error("[scheduler] task generation error:", e.message); });
  await runUptimeCheck().catch(function(e){ console.error("[scheduler] uptime error:", e.message); });
  await runCalendarSync().catch(function(e){ console.error("[scheduler] calendar sync error:", e.message); });
  await runBalanceInvoices().catch(function(e){ console.error("[scheduler] balance invoices error:", e.message); });
  await runReviewRequests().catch(function(e){ console.error("[scheduler] review requests error:", e.message); });
  var hour = new Date().getHours();
  if (hour === 8) { await sendDailyBriefing().catch(function(e){ console.error("[scheduler] briefing error:", e.message); }); }
  console.log("[scheduler] done");
}

module.exports = { runAll: runAll };
