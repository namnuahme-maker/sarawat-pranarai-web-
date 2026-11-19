/**
 * ⚡ SARAWAT MOTION ENGINE — Micro-interaction & Animation Utilities
 * Animation Team | โรงเรียนพระนารายณ์ • ฝ่ายบริหารงานสารวัตรนักเรียน
 *
 * ✅ Zero logic interference — this file ONLY adds/removes CSS classes
 *    and runs requestAnimationFrame helpers. No event listeners are
 *    overridden; all listeners are additive (useCapture: false, passive).
 *
 * Usage (from any page script):
 *   SarawatMotion.shake(el)             — validation error wiggle
 *   SarawatMotion.checkmark(el)         — success stamp pop
 *   SarawatMotion.counterPulse(el)      — number update flash
 *   SarawatMotion.leavePage(href)       — page-leave fade before navigate
 *   SarawatMotion.stagger(container)    — reveal children in sequence
 *   SarawatMotion.skeleton(el, on)      — toggle skeleton shimmer
 */

(function () {
  'use strict';

  // Respect prefers-reduced-motion — if set, most effects are skipped
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /* ----------------------------------------------------------
   * Utility helpers
   * ---------------------------------------------------------- */
  function addClass(el, cls) {
    if (el) el.classList.add(cls);
  }
  function removeClass(el, cls) {
    if (el) el.classList.remove(cls);
  }
  function oneAnimEnd(el, fn) {
    el.addEventListener('animationend', fn, { once: true });
  }

  /* ----------------------------------------------------------
   * SarawatMotion public API
   * ---------------------------------------------------------- */
  window.SarawatMotion = {

    /**
     * Shake an element — call after failed validation.
     * @param {HTMLElement} el
     */
    shake(el) {
      if (!el || reduced) return;
      removeClass(el, 'shake');
      void el.offsetWidth; // force reflow to restart animation
      addClass(el, 'shake');
      addClass(el, 'input-error-border');
      oneAnimEnd(el, () => {
        removeClass(el, 'shake');
        // keep red border until user corrects input
      });
    },

    /**
     * Remove error state from an input.
     * @param {HTMLElement} el
     */
    clearError(el) {
      if (!el) return;
      removeClass(el, 'shake');
      removeClass(el, 'input-error-border');
    },

    /**
     * Pop a checkmark/success element.
     * @param {HTMLElement} el
     */
    checkmark(el) {
      if (!el) return;
      if (reduced) { el.style.opacity = '1'; return; }
      removeClass(el, 'success-checkmark');
      void el.offsetWidth;
      addClass(el, 'success-checkmark');
    },

    /**
     * Flash a stat counter element when its value updates.
     * @param {HTMLElement} el
     */
    counterPulse(el) {
      if (!el || reduced) return;
      removeClass(el, 'counter-updated');
      void el.offsetWidth;
      addClass(el, 'counter-updated');
      oneAnimEnd(el, () => removeClass(el, 'counter-updated'));
    },

    /**
     * Smooth page-leave animation, then navigate.
     * @param {string} href
     */
    leavePage(href) {
      if (reduced) { window.location.href = href; return; }
      addClass(document.body, 'page-leaving');
      setTimeout(() => { window.location.href = href; }, 160);
    },

    /**
     * Stagger-reveal children of a container.
     * @param {HTMLElement} container
     */
    stagger(container) {
      if (!container) return;
      addClass(container, 'stagger-list');
    },

    /**
     * Toggle skeleton shimmer on an element.
     * @param {HTMLElement} el
     * @param {boolean} on — true to add skeleton, false to remove
     */
    skeleton(el, on) {
      if (!el) return;
      if (on) {
        addClass(el, 'skeleton');
      } else {
        removeClass(el, 'skeleton');
      }
    },

    /**
     * Animate a numeric counter from currentValue to targetValue over ~600ms.
     * @param {HTMLElement} el
     * @param {number} from
     * @param {number} to
     * @param {number} [duration=600] ms
     */
    countUp(el, from, to, duration = 600) {
      if (!el) return;
      if (reduced) { el.textContent = to; return; }
      const start = performance.now();
      const diff = to - from;
      function step(now) {
        const progress = Math.min((now - start) / duration, 1);
        // ease-out quart
        const eased = 1 - Math.pow(1 - progress, 4);
        el.textContent = Math.round(from + diff * eased).toLocaleString('th-TH');
        if (progress < 1) requestAnimationFrame(step);
        else {
          el.textContent = to.toLocaleString('th-TH');
          SarawatMotion.counterPulse(el);
        }
      }
      requestAnimationFrame(step);
    },
  };

  /* ----------------------------------------------------------
   * Passive: Smooth nav-link page exits
   * Wire page-leaving to all same-origin <a> clicks that are
   * not anchor links, not download links, not target="_blank".
   * ---------------------------------------------------------- */
  document.addEventListener('click', function (e) {
    if (reduced) return;
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript') ||
        a.target === '_blank' || a.download || a.rel?.includes('external') ||
        href.startsWith('http') || href.startsWith('//')) return;
    // only internal same-page navigations
    e.preventDefault();
    SarawatMotion.leavePage(href);
  }, false);

  /* ----------------------------------------------------------
   * Passive: Lazy-image fade-in
   * ---------------------------------------------------------- */
  if (!reduced && 'IntersectionObserver' in window) {
    const imgObserver = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        if (target.complete) {
          addClass(target, 'img-loaded');
        } else {
          target.addEventListener('load', () => addClass(target, 'img-loaded'), { once: true });
        }
        imgObserver.unobserve(target);
      });
    }, { rootMargin: '80px' });

    function observeImages() {
      document.querySelectorAll('img[loading="lazy"]:not(.img-loaded)').forEach(img => {
        imgObserver.observe(img);
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', observeImages);
    } else {
      observeImages();
    }
  }

  /* ----------------------------------------------------------
   * Passive: Mark live status dots on header after user loads
   * ---------------------------------------------------------- */
  document.addEventListener('sarawat:user_loaded', () => {
    // The green online dot on the logo and profile badge
    document.querySelectorAll('.status-online-dot, .live-dot').forEach(dot => {
      addClass(dot, 'live-dot');
    });
  });

})();
