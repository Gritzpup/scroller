# Tilt configuration for Reddit Auto-Scroller

# Frontend (Svelte/Vite) on port 5177
local_resource(
    'scroller-frontend',
    'npm run dev',
    labels=['web'],
    trigger_mode=TRIGGER_MODE_AUTO,
)

# Print info
print("""
═══════════════════════════════════════════════════════════════
✅ Reddit Auto-Scroller with Tampermonkey
═══════════════════════════════════════════════════════════════

🌐 Frontend: http://localhost:5177
   (or from network: http://192.168.1.51:5177)

📡 Architecture:
   - Control Panel (Svelte) opens Reddit in browser via window.open()
   - Tampermonkey userscript handles scrolling
   - No backend server needed
   - Browser window opens on YOUR machine (not server)

🚀 Setup:
   1. Install Tampermonkey browser extension
   2. Open control panel at http://localhost:5177
   3. Click "Install Now" to install the userscript
   4. Click "Open Reddit" to open Reddit in new window
   5. Click "Start Scrolling" when script is ready

═══════════════════════════════════════════════════════════════
""")
