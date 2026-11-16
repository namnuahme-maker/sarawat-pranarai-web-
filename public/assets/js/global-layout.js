/**
 * 🛡️ SARAWAT PRANARAI - UNIVERSAL GLOBAL LAYOUT & COMPONENT CONTROLLER
 * ควบคุม Header, Navigation Bar, Mobile Drawer, Auth Profile และ Shared Components
 * เพื่อให้ทุก Route ในระบบดึงโครงสร้างมาจากจุดเดียว (Strict UI Sync Standard)
 */

(function () {
  'use strict';

  // Navigation Items Specification (Cleaned up: removed redundant bodycam button)
  const NAV_ITEMS = [
    { id: 'home', label: 'หน้าหลัก', icon: '🛡️', href: '/' },
    { id: 'attendance-scan', label: 'สแกนเช็คชื่อ', icon: '⚡', href: '/attendance-scan', highlight: 'emerald' },
    { id: 'analytics', label: 'สถิติ & คลังข้อมูล', icon: '📊', href: '/analytics', highlight: 'cyan' },
    { id: 'card-studio', label: 'ทำบัตร', icon: '🎨', href: '/card-studio' },
    { id: 'lost-found', label: 'ของหาย', icon: '📦', href: '/lost-found' }
  ];

  // Detect Current Active Route
  function getActiveNavId() {
    const path = window.location.pathname.toLowerCase();
    if (path === '/' || path === '/index.html' || path === '/dashboard' || path === '/dashboard.html' || path === '/app' || path === '/console') {
      return 'home';
    }
    for (const item of NAV_ITEMS) {
      if (item.href !== '/' && path.startsWith(item.href)) {
        return item.id;
      }
    }
    return '';
  }

  // Create Header HTML
  function renderHeaderHTML() {
    const activeId = getActiveNavId();

    const desktopNavLinks = NAV_ITEMS.map(item => {
      const isActive = item.id === activeId;
      let activeClasses = 'text-slate-300 hover:text-white hover:bg-tactical-800';

      if (isActive) {
        if (item.highlight === 'emerald') {
          activeClasses = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow font-bold';
        } else if (item.highlight === 'cyan') {
          activeClasses = 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow font-bold';
        } else {
          activeClasses = 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow font-bold';
        }
      } else if (item.highlight === 'emerald') {
        activeClasses = 'text-emerald-300 hover:text-white hover:bg-emerald-600/20 border border-emerald-500/30';
      } else if (item.highlight === 'cyan') {
        activeClasses = 'text-cyan-300 hover:text-white hover:bg-cyan-600/20 border border-cyan-500/30';
      }

      return `
        <a href="${item.href}" class="nav-link px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 text-xs ${activeClasses}">
          <span>${item.icon}</span> ${item.label}
        </a>
      `;
    }).join('');

    const mobileNavLinks = NAV_ITEMS.map(item => {
      const isActive = item.id === activeId;
      let mobileClasses = 'bg-tactical-900 border-tactical-border text-slate-200 hover:text-amber-300';

      if (isActive) {
        if (item.highlight === 'emerald') {
          mobileClasses = 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-bold';
        } else if (item.highlight === 'cyan') {
          mobileClasses = 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 font-bold';
        } else {
          mobileClasses = 'bg-amber-500/20 border-amber-500/40 text-amber-300 font-bold';
        }
      }

      return `
        <a href="${item.href}" class="p-2.5 rounded-xl border flex items-center gap-2 text-xs active:scale-98 transition ${mobileClasses}">
          <span>${item.icon}</span> ${item.label}
        </a>
      `;
    }).join('');

    return `
      <header id="sarawat-global-header" class="sticky top-0 z-50 bg-black/90 backdrop-blur-md border-b border-tactical-border px-3 sm:px-4 py-2 sm:py-2.5 transition w-full max-w-full overflow-hidden">
        <div class="max-w-7xl mx-auto flex items-center justify-between gap-2 sm:gap-3 w-full flex-nowrap">
          
          <!-- Brand, School Logo & Left Quick Feature Menu -->
          <div class="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <a href="/" class="flex items-center gap-2 sm:gap-2.5 min-w-0 group flex-shrink-0">
              <div class="relative flex-shrink-0">
                <img src="/assets/logo.png" alt="ตราสารวัตรนักเรียน โรงเรียนพระนารายณ์" class="w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 object-contain drop-shadow-[0_0_10px_rgba(59,130,246,0.6)] group-hover:scale-105 transition" onerror="this.src='/assets/school_emblem.png'">
                <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 sm:w-2.5 sm:h-2.5 bg-emerald-500 rounded-full border-2 border-black animate-pulse"></span>
              </div>
              <div class="leading-tight min-w-0">
                <div class="flex items-center gap-1 sm:gap-1.5 flex-nowrap">
                  <span class="font-bold text-xs sm:text-sm tracking-wide text-slate-100 uppercase font-tactical truncate">SARAWAT PRANARAI</span>
                  <span class="hidden sm:inline-flex text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 font-semibold">TACTICAL-OS</span>
                </div>
                <p class="text-[10px] sm:text-[11px] text-slate-400 hidden md:block truncate">ศูนย์บัญชาการสารวัตรนักเรียน • โรงเรียนพระนารายณ์</p>
              </div>
            </a>

            <!-- Left Quick Feature Menu Dropdown (Annotation 6) -->
            <div class="relative">
              <button onclick="toggleLeftQuickMenu(event)" class="px-2 sm:px-2.5 py-1.5 rounded-lg bg-tactical-900 hover:bg-tactical-800 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 shadow-sm" title="เมนูฟังก์ชันด่วน (ทำบัตร, สแกนชื่อ, ของหาย)">
                <span class="animate-pulse">⚡</span>
                <span class="hidden md:inline">ฟังก์ชันระบบ</span>
                <svg class="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </button>

              <!-- Left Quick Menu Popover -->
              <div id="left-quick-menu-popover" class="hidden absolute left-0 top-full mt-2 w-56 rounded-2xl bg-tactical-900/95 backdrop-blur-xl border border-tactical-border shadow-2xl shadow-black/80 p-2 z-50 text-xs space-y-1">
                <div class="px-2.5 py-1 text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider border-b border-tactical-border/60 mb-1">
                  เครื่องมือปฏิบัติการ
                </div>
                <a href="/attendance-scan" class="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-emerald-300 hover:bg-emerald-500/20 hover:text-white transition font-semibold">
                  <span class="text-sm">⚡</span>
                  <div>
                    <div>สแกนเช็คชื่อ</div>
                    <div class="text-[10px] text-slate-400 font-normal">ระบบกล้อง Multi-Shot AI</div>
                  </div>
                </a>
                <a href="/card-studio" class="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-amber-300 hover:bg-amber-500/20 hover:text-white transition font-semibold">
                  <span class="text-sm">🎨</span>
                  <div>
                    <div>สตูดิโอทำบัตร</div>
                    <div class="text-[10px] text-slate-400 font-normal">บัตรประจำตัว CR80</div>
                  </div>
                </a>
                <a href="/lost-found" class="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-cyan-300 hover:bg-cyan-500/20 hover:text-white transition font-semibold">
                  <span class="text-sm">📦</span>
                  <div>
                    <div>คลังของหาย</div>
                    <div class="text-[10px] text-slate-400 font-normal">บันทึกของพบเจอ/ส่งมอบคืน</div>
                  </div>
                </a>
                <a href="/attendance-sheet" class="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-purple-300 hover:bg-purple-500/20 hover:text-white transition font-semibold">
                  <span class="text-sm">📄</span>
                  <div>
                    <div>ใบเช็คชื่อ A4</div>
                    <div class="text-[10px] text-slate-400 font-normal">ตารางเวร 12 สัปดาห์</div>
                  </div>
                </a>
              </div>
            </div>
          </div>

          <!-- Desktop Core Navigation Links -->
          <nav id="main-nav-bar" class="hidden lg:flex items-center flex-nowrap whitespace-nowrap gap-1.5 bg-tactical-900/90 border border-tactical-border rounded-xl p-1 font-sans text-xs flex-shrink-0">
            ${desktopNavLinks}
          </nav>

          <!-- Action Controls & User Profile & Mobile Toggle -->
          <div class="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-nowrap" id="header-action-container">
            <!-- Optional Page-Specific Action Slot -->
            <div id="header-page-action-slot" class="flex items-center gap-1.5"></div>

            <a href="https://discord.com/app" target="_blank" rel="noopener noreferrer" class="hidden xl:inline-flex px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 hover:text-white border border-indigo-500/40 text-xs items-center gap-1.5 transition whitespace-nowrap">
              <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.894.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
              <span class="hidden md:inline">Discord</span>
            </a>

            <!-- Mobile Hamburger Menu Button -->
            <button onclick="toggleMobileNav()" class="lg:hidden p-2 rounded-lg bg-tactical-900 text-slate-300 hover:text-white border border-tactical-border text-xs flex items-center justify-center transition active:scale-95 shadow-sm" aria-label="Toggle navigation">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </button>
          </div>

        </div>

        <!-- Mobile Dropdown Navigation Drawer -->
        <div id="mobile-nav-drawer" class="hidden lg:hidden pt-3 pb-2 border-t border-tactical-border/70 mt-2.5 grid grid-cols-2 gap-2 text-xs">
          ${mobileNavLinks}
          <button onclick="toggleMobileNav(); SarawatUI.openFeatureGuideModal();" class="col-span-2 p-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 flex items-center justify-center gap-2 text-amber-300 text-center font-semibold active:scale-98 transition">
            <span class="animate-pulse">💡</span> แนะนำฟังก์ชันและการใช้งานระบบ
          </button>
        </div>
      </header>
    `;
  }

  // Mobile Drawer Toggle
  window.toggleMobileNav = function () {
    const drawer = document.getElementById('mobile-nav-drawer');
    if (drawer) {
      drawer.classList.toggle('hidden');
    }
  };

  // Left Quick Menu Toggle (Annotation 6)
  window.toggleLeftQuickMenu = function (e) {
    if (e) e.stopPropagation();
    const popover = document.getElementById('left-quick-menu-popover');
    if (popover) {
      popover.classList.toggle('hidden');
    }
  };

  // Close Left Quick Menu when clicking outside
  document.addEventListener('click', (e) => {
    const popover = document.getElementById('left-quick-menu-popover');
    if (popover && !popover.classList.contains('hidden')) {
      if (!popover.contains(e.target)) {
        popover.classList.add('hidden');
      }
    }
  });

  // Mount Header to Document
  function mountGlobalHeader() {
    const existingHeader = document.querySelector('header');
    const headerHTML = renderHeaderHTML();

    if (existingHeader) {
      existingHeader.outerHTML = headerHTML;
    } else {
      document.body.insertAdjacentHTML('afterbegin', headerHTML);
    }

    // Attach Toast Container if missing
    if (!document.getElementById('sarawat-toast-container')) {
      const toastContainer = document.createElement('div');
      toastContainer.id = 'sarawat-toast-container';
      document.body.appendChild(toastContainer);
    }
  }

  // User Profile Loader via /api/auth/me
  async function loadUserProfile() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.loggedIn || !data.user) return;

      const user = data.user;
      window.currentUser = user;

      // Do not inject badge on attendance-scan to preserve camera viewport
      if (window.location.pathname.includes('attendance-scan')) return;
      if (document.getElementById('nav-user-profile-badge')) return;

      const headerActions = document.getElementById('header-action-container');
      if (!headerActions) return;

      const avatarUrl = user.avatar || '/assets/logo.png';
      const displayName = user.displayName || user.username || 'สารวัตร';
      const isSysAdmin = Boolean(user.isAdmin || user.role === 'ADMIN' || (user.rank && user.rank.includes('ดูแล')));
      const isTeacher = Boolean(user.isTeacher || user.role === 'TEACHER' || (user.rank && user.rank.includes('ครู')));
      let rankTitle = user.rank;
      if (!rankTitle || isSysAdmin || isTeacher) {
        if (isSysAdmin) {
          rankTitle = '⚡ ผู้ดูแลระบบ';
        } else if (isTeacher) {
          rankTitle = '👨‍🏫 ครูที่ปรึกษา';
        } else if (user.isLeader) {
          rankTitle = '👑 ผู้บริหาร/หัวหน้า';
        } else {
          rankTitle = '🛡️ สารวัตรนักเรียน';
        }
      }

      let badgeRoleColor = 'text-amber-400/90';
      let badgeBorderColor = 'border-indigo-500/70';
      let dotColor = 'bg-emerald-500';

      if (isSysAdmin) {
        badgeRoleColor = 'text-rose-400 font-bold';
        badgeBorderColor = 'border-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]';
        dotColor = 'bg-rose-500 shadow-[0_0_6px_#f43f5e]';
      } else if (isTeacher) {
        badgeRoleColor = 'text-amber-300 font-bold';
        badgeBorderColor = 'border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]';
        dotColor = 'bg-amber-400 shadow-[0_0_6px_#f59e0b]';
      }

      const profileBadge = document.createElement('div');
      profileBadge.id = 'nav-user-profile-badge';
      profileBadge.className = 'flex items-center gap-1.5 sm:gap-2 pl-1.5 sm:pl-2.5 border-l border-slate-800/80 flex-shrink-0';
      profileBadge.innerHTML = `
        <div class="flex items-center gap-1.5 sm:gap-2 cursor-pointer group" title="สารวัตร: ${displayName} (${user.username || ''})" onclick="toggleMobileNav()">
          <div class="relative flex-shrink-0">
            <img src="${avatarUrl}" alt="${displayName}" class="w-7 h-7 sm:w-8 sm:h-8 rounded-full border ${badgeBorderColor} shadow-md object-cover flex-shrink-0 group-hover:border-amber-400 transition" onerror="this.src='/assets/logo.png'">
            <span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${dotColor} border border-black"></span>
          </div>
          <div class="hidden md:flex flex-col text-left leading-tight">
            <span class="text-xs font-semibold text-slate-100 truncate max-w-[110px]">${displayName}</span>
            <span class="text-[10px] ${badgeRoleColor} font-mono truncate max-w-[110px]">${rankTitle}</span>
          </div>
        </div>
      `;

      // Insert before mobile hamburger button
      const hamburger = headerActions.querySelector('button[onclick*="toggleMobileNav"]');
      if (hamburger) {
        headerActions.insertBefore(profileBadge, hamburger);
      } else {
        headerActions.appendChild(profileBadge);
      }
    } catch (e) {
      console.warn('[GLOBAL-LAYOUT] Profile load error:', e);
    }
  }

  // Universal UI Helpers Object
  window.SarawatUI = {
    toast: function (message, type = 'info', duration = 3500) {
      const container = document.getElementById('sarawat-toast-container');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = 'sarawat-toast-item';

      let icon = 'ℹ️';
      let borderClass = 'border-tactical-border';
      if (type === 'success') {
        icon = '✅';
        borderClass = 'border-emerald-500/50 text-emerald-300';
      } else if (type === 'error') {
        icon = '🚨';
        borderClass = 'border-rose-500/50 text-rose-300';
      } else if (type === 'warning') {
        icon = '⚠️';
        borderClass = 'border-amber-500/50 text-amber-300';
      }

      toast.classList.add(borderClass);
      toast.innerHTML = `<span class="text-base">${icon}</span><span class="flex-1">${message}</span>`;
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(0.5rem) scale(0.95)';
        setTimeout(() => toast.remove(), 250);
      }, duration);
    },

    modal: function ({ title, bodyHtml, confirmText = 'ตกลง', cancelText = 'ยกเลิก', onConfirm }) {
      const existing = document.getElementById('sarawat-universal-modal');
      if (existing) existing.remove();

      const modalEl = document.createElement('div');
      modalEl.id = 'sarawat-universal-modal';
      modalEl.className = 'fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4';
      modalEl.innerHTML = `
        <div class="bg-tactical-900 border border-tactical-border rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between border-b border-tactical-border pb-3 mb-4">
            <h3 class="font-bold text-slate-100 text-sm sm:text-base flex items-center gap-2">
              <span class="text-amber-400">🛡️</span> ${title}
            </h3>
            <button onclick="document.getElementById('sarawat-universal-modal').remove()" class="text-slate-400 hover:text-white p-1 rounded-lg">✕</button>
          </div>
          <div class="text-slate-300 text-xs sm:text-sm space-y-3 leading-relaxed mb-5">
            ${bodyHtml}
          </div>
          <div class="flex justify-end gap-2 pt-3 border-t border-tactical-border">
            ${cancelText ? `<button onclick="document.getElementById('sarawat-universal-modal').remove()" class="btn-tactical btn-tactical-subtle">${cancelText}</button>` : ''}
            <button id="sarawat-modal-confirm-btn" class="btn-tactical btn-tactical-primary">${confirmText}</button>
          </div>
        </div>
      `;

      document.body.appendChild(modalEl);
      const confirmBtn = document.getElementById('sarawat-modal-confirm-btn');
      if (confirmBtn) {
        confirmBtn.onclick = () => {
          modalEl.remove();
          if (typeof onConfirm === 'function') onConfirm();
        };
      }
    },

    openFeatureGuideModal: function () {
      this.modal({
        title: 'แนะนำฟังก์ชันศูนย์บัญชาการสารวัตรนักเรียน',
        bodyHtml: `
          <div class="space-y-3 text-xs sm:text-sm">
            <div class="p-3 rounded-xl bg-tactical-950 border border-tactical-border">
              <span class="font-bold text-amber-300">🛡️ หน้าหลัก (Central Command):</span>
              <p class="text-slate-400 text-xs mt-1">มอนิเตอร์กำลังพลสารวัตร, คดีเหตุการณ์เร่งด่วน, ตารางเวรปฏิบัติหน้าที่ และสถานะบอท Discord 24 ชั่วโมง</p>
            </div>
            <div class="p-3 rounded-xl bg-tactical-950 border border-tactical-border">
              <span class="font-bold text-emerald-300">⚡ สแกนเช็คชื่อ (Multi-Shot):</span>
              <p class="text-slate-400 text-xs mt-1">ใช้กล้องสแกนตรวจใบตารางเช็คชื่อ A4 ดึง QR Anchor อัตโนมัติและส่งข้อมูลขึ้นระบบทันที</p>
            </div>
            <div class="p-3 rounded-xl bg-tactical-950 border border-tactical-border">
              <span class="font-bold text-cyan-300">📊 สถิติ & คลังข้อมูล (Analytics):</span>
              <p class="text-slate-400 text-xs mt-1">วิเคราะห์แนวโน้มการลาเวร สถิติการตรวจตรา รายงานสรุปผลไตรมาส</p>
            </div>
            <div class="p-3 rounded-xl bg-tactical-950 border border-tactical-border">
              <span class="font-bold text-indigo-300">🎨 ทำบัตร (Card Studio):</span>
              <p class="text-slate-400 text-xs mt-1">ออกแบบและพิมพ์บัตรประจำตัวสารวัตรนักเรียนมาตรฐานสากล CR80 Vertical</p>
            </div>
          </div>
        `,
        confirmText: 'รับทราบ',
        cancelText: null
      });
    }
  };

  // Backward compatibility aliases
  window.openFeatureGuideModal = function () {
    window.SarawatUI.openFeatureGuideModal();
  };

  // Auto initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountGlobalHeader();
      loadUserProfile();
    });
  } else {
    mountGlobalHeader();
    loadUserProfile();
  }

})();
