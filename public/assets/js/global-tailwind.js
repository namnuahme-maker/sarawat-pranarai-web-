/**
 * 🛡️ SARAWAT PRANARAI - GLOBAL TAILWIND CONFIGURATION
 * โครงสร้าง Configuration กลางสำหรับ Tailwind CSS CDN
 * กำหนด Theme, Colors, Fonts, และ Glow Tokens ร่วมกันทั้งโปรเจกต์
 */

window.tailwind = window.tailwind || {};
window.tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Chakra Petch', 'Prompt', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['Chakra Petch', 'JetBrains Mono', 'monospace'],
        tactical: ['Chakra Petch', 'Prompt', 'sans-serif'],
        display: ['Michroma', 'Syncopate', 'sans-serif']
      },
      colors: {
        tactical: {
          950: '#000000',
          900: '#060B13',
          850: '#0A101D',
          800: '#101A2E',
          750: '#142038',
          700: '#182744',
          border: '#162238',
          hover: '#1B2A4A'
        },
        navy: {
          950: '#020611',
          900: '#071226',
          850: '#0c1b38',
          800: '#12264d',
          700: '#1a376c',
          600: '#254d94',
          border: 'rgba(56, 189, 248, 0.18)',
          glow: 'rgba(6, 182, 212, 0.25)'
        },
        midnight: {
          950: '#050c1b',
          900: '#09162e',
          850: '#0e1f3f',
          800: '#142a53',
          700: '#1c3970',
          600: '#254d94'
        },
        accent: {
          gold: '#F59E0B',
          amber: '#D97706',
          cyan: '#06B6D4',
          emerald: '#10B981',
          crimson: '#EF4444'
        }
      },
      boxShadow: {
        'glow-cyan': '0 0 20px -5px rgba(6, 182, 212, 0.3)',
        'glow-amber': '0 0 20px -5px rgba(245, 158, 11, 0.3)',
        'glow-emerald': '0 0 20px -5px rgba(16, 185, 129, 0.3)',
        'glow-crimson': '0 0 20px -5px rgba(239, 68, 68, 0.3)',
        'tactical-glow': '0 0 25px -5px rgba(37, 99, 235, 0.25)'
      }
    }
  }
};
