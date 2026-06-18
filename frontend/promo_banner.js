(function() {
  var DISMISS_KEY = 'bsm_promo_dismissed';
  function getDismissed() { try { var d = localStorage.getItem(DISMISS_KEY); if (!d) return {}; return JSON.parse(d); } catch(e) { return {}; } }
  function setDismissed(id) { try { var d = getDismissed(); d[id] = Date.now() + 24*60*60*1000; localStorage.setItem(DISMISS_KEY, JSON.stringify(d)); } catch(e) {} }
  function isDismissed(id) { var d = getDismissed(); if (!d[id]) return false; return Date.now() < d[id]; }
  var preview = window.location.search.indexOf('preview_promo') !== -1;
  var THEMES = {
    gold:   { bg:'#C9A84C', text:'#1a1200', sub:'#5C4010', btn:'#1a1200', btnText:'#C9A84C', timer:'#1a1200', timerText:'#C9A84C', timerSub:'#7A5C10' },
    dark:   { bg:'#111111', text:'#C9A84C', sub:'#888888', btn:'#C9A84C', btnText:'#111111', timer:'#222222', timerText:'#C9A84C', timerSub:'#666666' },
    purple: { bg:'#26215C', text:'#EEEDFE', sub:'#AFA9EC', btn:'#C9A84C', btnText:'#1a1200', timer:'#1a1200', timerText:'#C9A84C', timerSub:'#534AB7' },
    coral:  { bg:'#993C1D', text:'#FAECE7', sub:'#F5C4B3', btn:'#FAECE7', btnText:'#993C1D', timer:'#1a1200', timerText:'#FAECE7', timerSub:'#F0997B' },
    teal:   { bg:'#0F6E56', text:'#E1F5EE', sub:'#9FE1CB', btn:'#C9A84C', btnText:'#1a1200', timer:'#1a1200', timerText:'#E1F5EE', timerSub:'#5DCAA5' }
  };
  function buildTimer(endDate, t, id) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:12px;';
    function block(key, label) {
      var b = document.createElement('div');
      b.style.cssText = 'background:'+t.timer+';border-radius:6px;padding:6px 14px;text-align:center;min-width:54px;';
      b.innerHTML = '<div id="bsm-t-'+key+'-'+id+'" style="font-size:22px;font-weight:500;color:'+t.timerText+';line-height:1;">00</div><div style="font-size:10px;color:'+t.timerSub+';letter-spacing:0.08em;text-transform:uppercase;">'+label+'</div>';
      return b;
    }
    wrap.appendChild(block('d','days')); wrap.appendChild(block('h','hrs')); wrap.appendChild(block('m','min')); wrap.appendChild(block('s','sec'));
    var end = new Date(endDate).getTime();
    function tick() {
      var diff = Math.max(0, Math.floor((end - Date.now()) / 1000));
      var d = Math.floor(diff/86400); diff%=86400; var h = Math.floor(diff/3600); diff%=3600; var m = Math.floor(diff/60); var s = diff%60;
      var pad = function(n){ return String(n).padStart(2,'0'); };
      ['d','h','m','s'].forEach(function(k,i){ var el = document.getElementById('bsm-t-'+k+'-'+id); if(el) el.textContent = pad([d,h,m,s][i]); });
    }
    tick(); setInterval(tick, 1000); return wrap;
  }

  // ── Live availability lookup ──────────────────────────────────────────────
  // Returns { count, nextDate } for a given YYYY-MM month, based on real
  // booked/blocked data from booking-service (the same data source the admin
  // Block Dates calendar uses). count = number of days in that month, from
  // today onward, that are neither booked nor blocked. nextDate = the
  // earliest such open date (YYYY-MM-DD), or null if none remain.
  function fetchAvailability(month) {
    return fetch('/api/bookings/availability?month=' + month).then(function(r) {
      return r.json();
    }).then(function(d) {
      var booked = d.bookedDates || [];
      var blocked = d.blockedDates || [];
      var taken = {};
      booked.concat(blocked).forEach(function(dateStr) {
        taken[dateStr.split('T')[0]] = true;
      });
      var parts = month.split('-');
      var year = parseInt(parts[0], 10);
      var mon = parseInt(parts[1], 10);
      var daysInMonth = new Date(year, mon, 0).getDate();
      var today = new Date(); today.setHours(0,0,0,0);
      var count = 0, nextDate = null;
      for (var day = 1; day <= daysInMonth; day++) {
        var d2 = new Date(year, mon - 1, day);
        if (d2 < today) continue;
        var ds = year + '-' + String(mon).padStart(2,'0') + '-' + String(day).padStart(2,'0');
        if (!taken[ds]) {
          count++;
          if (!nextDate) nextDate = ds;
        }
      }
      return { count: count, nextDate: nextDate };
    }).catch(function() {
      return { count: null, nextDate: null };
    });
  }

  // Scrolls to the booking form and, if a date is supplied, pre-fills the
  // session_date field. Triggered when a promo's CTA link is exactly '#book'.
  function openBookingForm(date) {
    if (typeof window.showForm === 'function') window.showForm('booking');
    if (date) {
      setTimeout(function() {
        var input = document.querySelector('#form-booking input[name="session_date"]');
        if (input) input.value = date;
      }, 150);
    }
  }

  function renderBanner(promo, availability) {
    if (!preview && isDismissed(promo.id)) return;
    var zone = document.getElementById('promo-zone');
    var zoneDefault = document.getElementById('promo-zone-default');
    if (!zone) return; // promo-zone isn't on this page (e.g. a sub-page) — nothing to render into.
    var t = THEMES[promo.bg_colour] || THEMES.gold;
    var banner = document.createElement('div');
    banner.id = 'bsm-promo-banner-'+promo.id;
    banner.style.cssText = 'width:100%;height:100%;background:'+t.bg+';padding:20px 32px;text-align:center;position:relative;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;';
    var close = document.createElement('button');
    close.innerHTML = '&times;';
    close.style.cssText = 'position:absolute;top:8px;right:16px;background:none;border:none;font-size:22px;color:'+t.sub+';cursor:pointer;line-height:1;padding:0;';
    close.onclick = function(){
      setDismissed(promo.id);
      banner.remove();
      if (zoneDefault) zoneDefault.style.display = 'flex';
    };
    banner.appendChild(close);
    if (promo.eyebrow) {
      var ey = document.createElement('div');
      ey.textContent = promo.eyebrow;
      ey.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:'+t.sub+';margin-bottom:8px;';
      banner.appendChild(ey);
    }
    var hl = document.createElement('div');
    var message = promo.message;
    if (promo.show_availability_count && availability && availability.count !== null) {
      message = message.replace(/\{count\}/g, availability.count);
    }
    hl.textContent = message;
    hl.style.cssText = 'font-size:clamp(16px,2.4vw,22px);font-weight:500;color:'+t.text+';margin-bottom:4px;line-height:1.2;font-family:Georgia,serif;';
    banner.appendChild(hl);
    if (promo.cta_label && promo.cta_link) {
      var cta = document.createElement('a');
      cta.textContent = promo.cta_label;
      var isBookingCta = promo.cta_link === '#book';
      if (isBookingCta) {
        cta.href = '#';
        var nextDate = availability ? availability.nextDate : null;
        cta.addEventListener('click', function(e) {
          e.preventDefault();
          openBookingForm(nextDate);
        });
      } else {
        cta.href = promo.cta_link;
      }
      cta.style.cssText = 'display:inline-block;background:'+t.btn+';color:'+t.btnText+';font-size:12px;font-weight:600;padding:8px 24px;border-radius:4px;text-decoration:none;margin-top:8px;letter-spacing:0.05em;cursor:pointer;';
      banner.appendChild(cta);
    }
    if (promo.show_countdown && promo.ends_at) banner.appendChild(buildTimer(promo.ends_at, t, promo.id));
    if (zoneDefault) zoneDefault.style.display = 'none';
    zone.appendChild(banner);
  }

  function init() {
    fetch('/api/promotions/active').then(function(r){ return r.json(); }).then(function(promo) {
      if (!promo || promo.type !== 'banner') return;
      if (promo.show_availability_count && promo.availability_month) {
        fetchAvailability(promo.availability_month).then(function(availability) {
          renderBanner(promo, availability);
        });
      } else {
        renderBanner(promo, null);
      }
    }).catch(function(e){ console.warn('[bsm promo]', e.message); });
  }
  if (document.readyState==='loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
