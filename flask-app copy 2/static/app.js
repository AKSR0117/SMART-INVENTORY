const $ = id => document.getElementById(id);

async function api(url, opt = {}) {
  opt.credentials = opt.credentials || 'same-origin';
  const r = await fetch(url, opt);
  const d = await r.json();

  if (!r.ok) {
    throw new Error(d.error || 'Request failed');
  }

  return d;
}


/* =========================
   GLOBAL STATE
========================= */

let currentTab = 'home';

let products = [];
let activeProduct = null;

let qtyDraft = 1;

let cameraOn = false;
let html5QrCode = null;

let lowStock = [];
let expiringSoon = [];

let dashboard = null;
let sales = [];

let stockHistory = [];
let stockAnalytics = null;
let salesAnalytics = null;
let demandForecast = null;
let productClassification = null;

let vendorxData = null;
let vendorxTimer = null;
let vendorxAutoRefresh = true;
let vendorxScannerRunning = false;

let cart = [];

let scanMode = 'scan';
let lastReceipt = null;

let screenOrigin = 'home';
let profileUser = null;


/* =========================
   HELPERS
========================= */

function round2(n) {
  return Math.round(n * 100) / 100;
}


function fmtTime(ts) {
  return new Date(ts).toLocaleString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short'
  });
}


function expiryStatus(dateStr) {

  if (!dateStr) return null;

  const days = Math.ceil(
    (new Date(dateStr) - new Date()) / 86400000
  );

  if (days < 0) {
    return {
      cls: 'exp',
      label: 'Expired'
    };
  }

  if (days <= 14) {
    return {
      cls: 'exp',
      label: `Expires in ${days}d`
    };
  }

  return null;
}


function showToast(msg, kind) {

  const root = $('toastRoot');

  if (!root) return;

  const el = document.createElement('div');

  el.className = 'toast' + (kind ? ' ' + kind : '');

  el.textContent = msg;

  root.appendChild(el);

  requestAnimationFrame(() => {
    el.classList.add('show');
  });

  setTimeout(() => {

    el.classList.remove('show');

    setTimeout(() => {
      el.remove();
    }, 250);

  }, 2600);
}


/* =========================
   TAB NAVIGATION
========================= */

document.querySelectorAll('.tab-btn').forEach(btn => {

  btn.addEventListener('click', () => {

    switchTab(btn.dataset.tab);

  });

});


const notificationBtn = $('notificationBtn');

if (notificationBtn) {

  notificationBtn.addEventListener('click', () => {

    screenOrigin = 'home';

    currentTab = 'alerts';

    document.body.className = 'theme-alerts';

    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
    });

    refreshAndRender();

  });

}


function switchTab(tab) {

  if (currentTab === 'scan' && tab !== 'scan') {
    stopScanner();
  }

  if (currentTab === 'vendorx' && tab !== 'vendorx') {
    stopVendorXPolling();
  }

  currentTab = tab;

  if (tab === 'vendorx') {
    startVendorXPolling();
  }

  activeProduct = null;
  qtyDraft = 1;

  scanMode = 'scan';

  document.body.className = 'theme-' + tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {

    btn.classList.toggle(
      'active',
      btn.dataset.tab === tab
    );

  });

  refreshAndRender();
}


/* =========================
   DATA REFRESH
========================= */

async function refreshAndRender() {

  try {

    products = await api('/products');

    const countEl = $('headerStockCount');

    if (countEl) {
      countEl.textContent = products.length;
    }


    lowStock = await api('/low-stock');

    expiringSoon = await api('/expiring-soon');

    updateNotificationBadge();


    if (currentTab === 'dashboard') {

      dashboard = await api('/dashboard');

      sales = await api('/sales');

    }


    if (currentTab === 'history') {

      dashboard = await api('/dashboard');

      sales = await api('/sales');

    }


    if (currentTab === 'recommendations') {

      demandForecast = await api('/demand-forecast');

      productClassification = await api('/product-classification');

    }


    if (currentTab === 'profile') {

      const me = await api('/me');

      profileUser = me && me.user ? me.user : null;

    }

  } catch (e) {

    showToast(
      'Could not reach the server: ' + e.message,
      'warn'
    );

  }

  render();
}


/* =========================
   NOTIFICATION BADGE
========================= */

function updateNotificationBadge() {

  const badge = $('notificationBadge');

  if (!badge) return;

  const count =
    (lowStock ? lowStock.length : 0) +
    (expiringSoon ? expiringSoon.length : 0);

  if (count > 0) {

    badge.textContent = count > 99 ? '99+' : count;

    badge.style.display = 'flex';

  } else {

    badge.style.display = 'none';

  }
}


/* =========================
   MAIN RENDER
========================= */

function render() {

  const main = $('mainContent');

  if (!main) return;


  if (currentTab === 'home') {
    main.innerHTML = renderHomeTab();
  }

  if (currentTab === 'scan') {
    main.innerHTML = renderScanTab();
  }

  if (currentTab === 'vendorx') {
    main.innerHTML = renderVendorXTab();
  }

  if (currentTab === 'inventory') {
    main.innerHTML = renderInventoryTab();
  }

  if (currentTab === 'alerts') {
    main.innerHTML = renderAlertsTab();
  }

  if (currentTab === 'dashboard') {
    main.innerHTML = renderDashboardTab();
  }

  if (currentTab === 'history') {
    main.innerHTML = renderHistoryTab();
  }

  if (currentTab === 'recommendations') {
    main.innerHTML = renderRecommendationsTab();
  }

  if (currentTab === 'profile') {
    main.innerHTML = renderProfileTab();
  }


  attachEvents();
}


/* =========================
   HOME SCREEN
========================= */

function renderHomeTab() {

  return `

    <section class="home-screen">
      <section class="hero-panel">
        <div class="hero-copy">
          <div class="home-eyebrow">SMART RETAIL INTELLIGENCE</div>
          <h2>Scan. Identify.<br>Know more.</h2>
          <p>Use barcode scanning or Edge AI to instantly identify products, check details and track inventory.</p>
          <button type="button" class="hero-action" id="homeBarcodeBtn"><span class="hero-action-icon">▣</span><span>Start Scanning</span><span class="hero-action-arrow">→</span></button>
        </div>
      </section>

      <section class="quick-section">
        <div class="section-heading-row"><div><h2>Quick Access</h2><p>Everything you need, in one place.</p></div></div>
        <div class="quick-grid">
          <button type="button" class="quick-card quick-blue" id="homeBarcodeQuickBtn"><span class="quick-icon">||||</span><strong>Barcode Scanner</strong><p>Scan products & get instant details.</p><span class="quick-arrow">→</span></button>
          <button type="button" class="quick-card quick-purple" id="homeAiBtn"><span class="quick-icon">✣</span><strong>Edge AI</strong><p>Detect missing, damaged or unavailable items.</p><span class="quick-arrow">→</span></button>
          <button type="button" class="quick-card quick-teal" data-tab="inventory"><span class="quick-icon">◇</span><strong>Inventory</strong><p>Track stock and manage products.</p><span class="quick-arrow">→</span></button>
        </div>
      </section>

      <section class="overview-panel">
        <div class="overview-heading"><h3>Your Store Overview</h3><span>Last 7 days⌄</span></div>
        <div class="overview-stats">
          <div><span class="overview-icon">◇</span><strong>${products.length}</strong><label>Products</label><em>↑ 2%</em></div>
          <div><span class="overview-icon">△</span><strong>${products.filter(p => Number(p.quantity) <= Number(p.low_stock_level)).length}</strong><label>Low Stock</label><em>↑ 0%</em></div>
          <div><span class="overview-icon">🛒</span><strong>${cart.reduce((s, c) => s + c.quantity, 0)}</strong><label>Cart Items</label><em>↑ 0%</em></div>
        </div>
      </section>

    </section>

  `;
}


/* =========================
   BARCODE SCANNER SCREEN
========================= */

function renderScanTab() {

  if (scanMode === 'cart') {
    return renderCartView();
  }


  if (scanMode === 'receipt') {
    return renderReceiptView();
  }


  return `

    <div class="page-top">

      <button
        type="button"
        class="back-home"
        id="backHomeBtn"
      >
        ← Home
      </button>

      <div class="page-label">
        PRODUCT IDENTIFICATION
      </div>

    </div>


    <div class="scanner-page-header">

      <div>

        <h2 class="section-title">
          📷 Barcode Scanner
        </h2>

        <p class="page-subtitle">
          Scan a barcode to identify the product
          and manage inventory.
        </p>

      </div>

      <div class="scanner-status">
        ● LIVE
      </div>

    </div>

    <div style="display:flex; gap:10px; margin-bottom:16px;">
      <button type="button" class="btn" style="flex:1; background:rgba(99,230,190,.15); color:var(--good); border:1px solid rgba(99,230,190,.3); font-weight:700; border-radius:10px; padding:10px;">
        📷 Barcode Scanner
      </button>
      <button type="button" class="btn" id="switchToVendorXBtn" style="flex:1; background:rgba(122,167,255,.12); color:var(--accent); border:1px solid rgba(122,167,255,.3); font-weight:700; border-radius:10px; padding:10px; cursor:pointer;">
        🤖 VendorX AI Vision
      </button>
    </div>

    ${renderCartBar()}


    <div class="card scanner-card">

      <div class="scanner-title">

        <div>
          <strong>
            Camera Scanner
          </strong>

          <span>
            Fast product lookup
          </span>
        </div>

        <div class="scanner-symbol">
          BAR
        </div>

      </div>


      <div
        id="reader"
        style="display:${cameraOn ? 'block' : 'none'}"
      ></div>


      ${
        !cameraOn

          ? `
            <button
              class="btn btn-primary btn-block camera-btn"
              id="startCamBtn"
            >
              📷 Start camera scan
            </button>
          `

          : `
            <button
              class="btn btn-ghost btn-block"
              id="stopCamBtn"
            >
              Stop camera
            </button>
          `
      }


      <p class="scan-hint">
        Point the camera at a barcode.
        Camera access requires HTTPS or localhost.
      </p>


      <div class="manual-divider">
        <span>OR ENTER MANUALLY</span>
      </div>


      <div class="manual-row">

        <input
          type="text"
          id="manualBarcode"
          placeholder="Type or scan barcode"
        />

        <button
          class="btn btn-small"
          id="manualGoBtn"
        >
          Search
        </button>

      </div>

    </div>


    <div id="ticketArea">

      ${activeProduct ? renderTicket() : ''}

    </div>

  `;
}


/* =========================
   VENDORX AI VISION SCREEN
========================= */

function stopVendorXPolling() {
  if (vendorxTimer) {
    clearInterval(vendorxTimer);
    vendorxTimer = null;
  }
}

async function startVendorXPolling() {
  stopVendorXPolling();
  // Fetch scanner process status first
  try {
    const ps = await api('/api/vendorx/process-status');
    vendorxScannerRunning = ps.running;
  } catch(e) {}
  await refreshVendorXData();
  if (vendorxAutoRefresh) {
    vendorxTimer = setInterval(async () => {
      if (currentTab === 'vendorx' && vendorxAutoRefresh) {
        try {
          const ps = await api('/api/vendorx/process-status');
          vendorxScannerRunning = ps.running;
        } catch(e) {}
        await refreshVendorXData();
      }
    }, 2000);
  }
}

async function refreshVendorXData() {
  try {
    vendorxData = await api('/api/vendorx/latest');
    if (currentTab === 'vendorx') {
      const main = $('mainContent');
      if (main) {
        main.innerHTML = renderVendorXTab();
        attachVendorXEvents();
      }
    }
  } catch (e) {
    console.error('VendorX poll error:', e);
  }
}

function renderVendorXTab() {
  const isAvailable = vendorxData && vendorxData.available;
  const isLive = vendorxData && vendorxData.is_live;
  const productsList = (vendorxData && vendorxData.products) || [];
  const qty = (vendorxData && vendorxData.quantity) || 0;
  const conf = vendorxData ? Math.round(vendorxData.confidence * 100) : 0;
  const mrp = vendorxData ? vendorxData.mrp : null;
  const exp = vendorxData ? (vendorxData.expiry_date || vendorxData.expiry_date_iso) : null;
  const mfd = vendorxData ? vendorxData.manufacturing_date : null;
  const batch = vendorxData ? vendorxData.batch : null;
  const running = vendorxScannerRunning;

  return `
    <div class="page-top">
      <button type="button" class="back-home" id="vendorxBackHomeBtn">← Home</button>
      <div class="page-label">EDGE AI VISION SCANNER</div>
    </div>

    <div class="scanner-page-header">
      <div>
        <h2 class="section-title">🤖 VendorX AI Vision Scanner</h2>
        <p class="page-subtitle">Real-time YOLO product detection + OCR — launched right from the browser.</p>
      </div>
      <div class="scanner-status" style="background:${isLive ? 'rgba(99,230,190,.18)' : (running ? 'rgba(255,200,87,.18)' : 'rgba(255,255,255,.06)')}; color:${isLive ? 'var(--good)' : (running ? 'var(--warning)' : 'var(--ink-soft)')}; border:1px solid ${isLive ? 'rgba(99,230,190,.3)' : (running ? 'rgba(255,200,87,.3)' : 'var(--line)')}; padding:6px 12px; border-radius:999px; font-size:12px; font-weight:700;">
        ${isLive ? '● LIVE AI STREAM' : (running ? '◉ SCANNER RUNNING' : '○ IDLE')}
      </div>
    </div>

    <div style="display:flex; gap:10px; margin-bottom:16px;">
      <button type="button" class="btn" id="switchToBarcodeBtn" style="flex:1; background:rgba(255,255,255,.08); color:var(--ink-soft); border:1px solid var(--line); font-weight:700; border-radius:10px; padding:10px; cursor:pointer;">
        📷 Barcode Scanner
      </button>
      <button type="button" class="btn" style="flex:1; background:rgba(122,167,255,.18); color:var(--accent); border:1px solid rgba(122,167,255,.3); font-weight:700; border-radius:10px; padding:10px;">
        🤖 VendorX AI Vision
      </button>
    </div>

    ${renderCartBar()}

    <!-- LAUNCH CAMERA CARD -->
    <div class="card" style="padding:24px; border:1px solid ${running ? 'rgba(99,230,190,.3)' : 'var(--line)'}; border-radius:18px; margin-bottom:18px; background:${running ? 'rgba(99,230,190,.06)' : 'var(--surface)'}; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:18px;">
      <div>
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
          <span style="font-size:28px;">${running ? '🎥' : '📷'}</span>
          <div>
            <strong style="font-size:16px; display:block;">${running ? 'AI Camera Scanner is Running' : 'Start AI Camera Scanner'}</strong>
            <span style="font-size:13px; color:var(--ink-soft);">${running ? 'Camera window is open on your desktop. Detection results stream here automatically.' : 'Launches the VendorX YOLO + RapidOCR scanner on your webcam.'}</span>
          </div>
        </div>
        ${running ? `<div style="font-size:12px; color:var(--ink-soft); margin-top:4px;">Hold a product packet in front of your webcam → detections appear below in real-time.</div>` : `<div style="font-size:12px; color:var(--ink-soft); margin-top:4px;">Requires: <code>pip install -r requirements-ai.txt</code></div>`}
      </div>
      <div style="display:flex; gap:10px; flex-shrink:0;">
        ${running ? `
          <button type="button" id="vendorxStopCameraBtn" class="btn" style="background:rgba(255,107,122,.15); color:var(--danger); border:1px solid rgba(255,107,122,.3); padding:12px 22px; border-radius:12px; font-weight:700; font-size:15px; cursor:pointer;">
            ⏹ Stop Camera
          </button>
        ` : `
          <button type="button" id="vendorxLaunchCameraBtn" class="btn primary" style="padding:12px 28px; border-radius:12px; font-weight:700; font-size:15px; cursor:pointer; min-width:200px;">
            🚀 Launch Camera
          </button>
        `}
      </div>
    </div>

    <!-- Status / Detection Feed -->
    <div class="card" style="padding:16px 20px; border:1px solid var(--line); border-radius:16px; margin-bottom:16px; background:var(--surface);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div>
          <strong style="font-size:14px; display:block;">Live Detection Feed</strong>
          <span style="color:var(--ink-soft); font-size:13px;">
            ${vendorxData && vendorxData.last_updated ? `Last detection: ${vendorxData.last_updated} (${vendorxData.age_seconds}s ago)` : 'No recent detection. Start the camera scanner above.'}
          </span>
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" id="vendorxRefreshBtn" class="btn" style="background:rgba(255,255,255,.08); border:1px solid var(--line); color:var(--ink); padding:8px 14px; border-radius:10px; cursor:pointer; font-weight:600; font-size:13px;">
            🔄 Refresh
          </button>
          <button type="button" id="vendorxAutoToggleBtn" class="btn" style="background:${vendorxAutoRefresh ? 'rgba(99,230,190,.15)' : 'rgba(255,255,255,.05)'}; border:1px solid ${vendorxAutoRefresh ? 'rgba(99,230,190,.3)' : 'var(--line)'}; color:${vendorxAutoRefresh ? 'var(--good)' : 'var(--ink-soft)'}; padding:8px 14px; border-radius:10px; cursor:pointer; font-weight:600; font-size:13px;">
            ${vendorxAutoRefresh ? '⚡ Auto: ON' : '⏸ Auto: OFF'}
          </button>
        </div>
      </div>
    </div>

    <!-- Detection Result -->
    <div class="card" style="padding:22px; border:1px solid var(--line); border-radius:18px; background:var(--surface);">
      ${productsList.length > 0 ? `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; border-bottom:1px solid var(--line); padding-bottom:16px; margin-bottom:18px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="background:rgba(122,167,255,.18); color:var(--accent); padding:3px 9px; border-radius:6px; font-size:11px; font-weight:700;">YOLO DETECTED</span>
              <span style="background:rgba(99,230,190,.18); color:var(--good); padding:3px 9px; border-radius:6px; font-size:11px; font-weight:700;">${conf}% CONFIDENCE</span>
            </div>
            <h3 style="margin:10px 0 4px; font-size:22px; font-family:'Space Grotesk',sans-serif;">${productsList[0].name}</h3>
            <div style="color:var(--ink-soft); font-size:13px;">Detected Units: <strong>${qty}</strong></div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px; color:var(--ink-soft);">MRP / ESTIMATED PRICE</div>
            <div style="font-size:24px; font-weight:800; color:var(--good);">₹${mrp !== null ? mrp : (productsList[0].price || '--')}</div>
          </div>
        </div>

        <div class="ocr-meta-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:12px; margin-bottom:20px;">
          <div style="background:rgba(0,0,0,.25); border:1px solid var(--line); border-radius:12px; padding:12px;">
            <div style="font-size:11px; color:var(--ink-soft); font-weight:600;">MRP (OCR)</div>
            <div style="font-size:16px; font-weight:700; color:var(--ink); margin-top:4px;">${mrp !== null ? '₹' + mrp : '<span style="color:var(--ink-soft); font-size:13px;">Scanning...</span>'}</div>
          </div>
          <div style="background:rgba(0,0,0,.25); border:1px solid var(--line); border-radius:12px; padding:12px;">
            <div style="font-size:11px; color:var(--ink-soft); font-weight:600;">EXPIRY DATE (OCR)</div>
            <div style="font-size:15px; font-weight:700; color:var(--warning); margin-top:4px;">${exp || '<span style="color:var(--ink-soft); font-size:13px;">Scanning...</span>'}</div>
          </div>
          <div style="background:rgba(0,0,0,.25); border:1px solid var(--line); border-radius:12px; padding:12px;">
            <div style="font-size:11px; color:var(--ink-soft); font-weight:600;">MFD (OCR)</div>
            <div style="font-size:15px; font-weight:700; color:var(--ink); margin-top:4px;">${mfd || '<span style="color:var(--ink-soft); font-size:13px;">Scanning...</span>'}</div>
          </div>
          <div style="background:rgba(0,0,0,.25); border:1px solid var(--line); border-radius:12px; padding:12px;">
            <div style="font-size:11px; color:var(--ink-soft); font-weight:600;">BATCH NO</div>
            <div style="font-size:14px; font-family:'IBM Plex Mono',monospace; color:var(--accent); margin-top:4px;">${batch || '<span style="color:var(--ink-soft); font-size:13px;">--</span>'}</div>
          </div>
        </div>

        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          ${productsList[0].in_database ? `
            <button type="button" class="btn primary" id="vendorxAddCartBtn" style="flex:1; min-width:180px; padding:14px; font-size:15px; font-weight:700; border-radius:12px; cursor:pointer;">
              🛒 Add to Cart (${qty})
            </button>
            <button type="button" class="btn" id="vendorxRestockBtn" style="flex:1; min-width:160px; padding:14px; font-size:15px; font-weight:700; border-radius:12px; background:rgba(255,255,255,.08); border:1px solid var(--line); color:var(--ink); cursor:pointer;">
              📦 Quick Restock (+${qty})
            </button>
          ` : `
            <button type="button" class="btn primary" id="vendorxRegisterBtn" style="flex:1; min-width:200px; padding:14px; font-size:15px; font-weight:700; border-radius:12px; cursor:pointer;">
              ➕ Register & Add to Inventory
            </button>
          `}
        </div>
      ` : `
        <div style="text-align:center; padding:36px 20px;">
          <div style="font-size:42px; margin-bottom:12px;">${running ? '🎥' : '🔍'}</div>
          <h3 style="margin:0 0 8px; font-size:20px;">${running ? 'Camera Running — Waiting for detection...' : 'No detection yet'}</h3>
          <p style="color:var(--ink-soft); max-width:420px; margin:0 auto; font-size:14px;">
            ${running ? 'Hold a product packet in front of your webcam. Results appear here automatically every 2 seconds.' : 'Click "🚀 Launch Camera" above to start the VendorX AI scanner.'}
          </p>
        </div>
      `}
    </div>

    <!-- Trained Classes Quick Tray -->
    <section class="quick-section" style="margin-top:28px;">
      <div class="section-heading-row">
        <div>
          <h2>Trained Retail Products (8 Classes)</h2>
          <p>Products the AI model is trained to identify from your webcam.</p>
        </div>
      </div>
      <div class="products-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:14px; margin-top:14px;">
        ${products.filter(p => [
          "Haldiram's Lite Mixture", "Nutberry Muesli Dark Chocolate", "Swisse Magnesium",
          "Kayakalp Taila", "Cantabil Vintage Deo", "Swasari Pravahi", "Psorogrit", "Fevigum Lime"
        ].some(name => p.name.toLowerCase().includes(name.toLowerCase()))).map(p => `
          <div class="card" style="padding:16px; border:1px solid var(--line); border-radius:14px; display:flex; flex-direction:column; justify-content:space-between; background:var(--surface);">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <span style="font-size:11px; background:rgba(99,230,190,.15); color:var(--primary); padding:2px 7px; border-radius:6px; font-weight:700;">AI READY</span>
                <span style="font-size:13px; font-weight:700; color:var(--ink-soft);">${round2(p.quantity)} ${p.unit}</span>
              </div>
              <h4 style="margin:8px 0 4px; font-size:15px; color:var(--ink);">${p.name}</h4>
              <div style="font-size:12px; color:var(--ink-soft);">${p.category || 'Retail'} · ₹${round2(p.price)}</div>
            </div>
            <div style="display:flex; gap:8px; margin-top:14px;">
              <button type="button" class="quick-add-cart-btn" data-barcode="${p.barcode}" style="flex:1; background:rgba(255,255,255,.08); border:1px solid var(--line); color:var(--ink); padding:8px; border-radius:8px; cursor:pointer; font-size:13px; font-weight:600;">
                🛒 Add
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}



function attachVendorXEvents() {
  const backBtn = $('vendorxBackHomeBtn');
  if (backBtn) backBtn.addEventListener('click', () => switchTab('home'));

  const switchBarcode = $('switchToBarcodeBtn');
  if (switchBarcode) switchBarcode.addEventListener('click', () => switchTab('scan'));

  // Launch Camera button
  const launchBtn = $('vendorxLaunchCameraBtn');
  if (launchBtn) {
    launchBtn.addEventListener('click', async () => {
      launchBtn.disabled = true;
      launchBtn.textContent = '⏳ Starting...';
      try {
        const res = await api('/api/vendorx/start', { method: 'POST' });
        vendorxScannerRunning = true;
        showToast('🎥 VendorX camera launched! Check your desktop for the scanner window.', 'ok');
        vendorxAutoRefresh = true;
        await startVendorXPolling();
      } catch (err) {
        showToast('Failed to launch camera: ' + err.message, 'err');
        const main = $('mainContent');
        if (main) { main.innerHTML = renderVendorXTab(); attachVendorXEvents(); }
      }
    });
  }

  // Stop Camera button
  const stopCamBtn = $('vendorxStopCameraBtn');
  if (stopCamBtn) {
    stopCamBtn.addEventListener('click', async () => {
      stopCamBtn.disabled = true;
      stopCamBtn.textContent = '⏳ Stopping...';
      try {
        await api('/api/vendorx/stop', { method: 'POST' });
        vendorxScannerRunning = false;
        stopVendorXPolling();
        showToast('⏹ VendorX scanner stopped.', 'ok');
        const main = $('mainContent');
        if (main) { main.innerHTML = renderVendorXTab(); attachVendorXEvents(); }
      } catch (err) {
        showToast('Error stopping scanner: ' + err.message, 'err');
      }
    });
  }

  const refreshBtn = $('vendorxRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await refreshVendorXData();
      showToast('Detection feed refreshed', 'ok');
    });
  }

  const autoToggleBtn = $('vendorxAutoToggleBtn');
  if (autoToggleBtn) {
    autoToggleBtn.addEventListener('click', () => {
      vendorxAutoRefresh = !vendorxAutoRefresh;
      if (vendorxAutoRefresh) {
        startVendorXPolling();
        showToast('Auto-sync enabled (2s)', 'ok');
      } else {
        stopVendorXPolling();
        showToast('Auto-sync paused', 'ok');
      }
      const main = $('mainContent');
      if (main) { main.innerHTML = renderVendorXTab(); attachVendorXEvents(); }
    });
  }

  const addCartBtn = $('vendorxAddCartBtn');
  if (addCartBtn && vendorxData && vendorxData.products && vendorxData.products.length > 0) {
    addCartBtn.addEventListener('click', () => {
      const det = vendorxData.products[0];
      const p = products.find(prod => prod.barcode === det.barcode || prod.name.toLowerCase() === det.name.toLowerCase());
      if (p) {
        qtyDraft = det.detected_quantity || 1;
        addToCart(p);
        qtyDraft = 1;
        showToast(`Added ${p.name} (x${det.detected_quantity || 1}) to cart!`, 'ok');
        render();
      } else {
        showToast('Product not found in inventory', 'err');
      }
    });
  }

  const restockBtn = $('vendorxRestockBtn');
  if (restockBtn && vendorxData && vendorxData.products && vendorxData.products.length > 0) {
    restockBtn.addEventListener('click', async () => {
      const det = vendorxData.products[0];
      try {
        await api('/restock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode: det.barcode, quantity: det.detected_quantity || 1, expiry_date: vendorxData.expiry_date_iso || null })
        });
        showToast(`Restocked ${det.name} (+${det.detected_quantity || 1})!`, 'ok');
        products = await api('/products');
        render();
      } catch (err) { showToast(err.message, 'err'); }
    });
  }

  const registerBtn = $('vendorxRegisterBtn');
  if (registerBtn && vendorxData && vendorxData.products && vendorxData.products.length > 0) {
    registerBtn.addEventListener('click', async () => {
      const det = vendorxData.products[0];
      try {
        await api('/api/vendorx/quick-add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: det.name, mrp: vendorxData.mrp || 0, price: vendorxData.mrp || 0, quantity: det.detected_quantity || 1, expiry_date: vendorxData.expiry_date_iso || null })
        });
        showToast(`Registered ${det.name} into inventory!`, 'ok');
        products = await api('/products');
        render();
      } catch (err) { showToast(err.message, 'err'); }
    });
  }

  document.querySelectorAll('.quick-add-cart-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = products.find(x => x.barcode === btn.dataset.barcode);
      if (p) { qtyDraft = 1; addToCart(p); showToast(`Added ${p.name} to cart!`, 'ok'); render(); }
    });
  });
}


/* =========================
   CART BAR
========================= */

function renderCartBar() {

  if (!cart.length) {
    return '';
  }


  const items = cart.reduce(
    (s, c) => s + c.quantity,
    0
  );


  const total = round2(
    cart.reduce(
      (s, c) => s + c.price * c.quantity,
      0
    )
  );


  return `

    <button
      type="button"
      class="cart-bar"
      id="openCartBtn"
    >

      <span>
        🧺 Cart:
        ${items}
        item${items > 1 ? 's' : ''}
        · ₹${total}
      </span>

      <span class="cart-arrow">
        View →
      </span>

    </button>

  `;
}


/* =========================
   CART VIEW
========================= */

function renderCartView() {

  const total = round2(
    cart.reduce(
      (s, c) => s + c.price * c.quantity,
      0
    )
  );


  const rows = cart.map((c, i) => `

    <div class="cart-row">

      <div>

        <div class="name">
          ${c.name}
        </div>

        <div class="meta">
          ${round2(c.quantity)}
          ${c.unit}
          × ₹${c.price}
        </div>

      </div>


      <div class="cart-row-right">

        <span class="cart-sub">
          ₹${round2(c.price * c.quantity)}
        </span>

        <button
          type="button"
          class="cart-remove"
          data-idx="${i}"
        >
          ✕
        </button>

      </div>

    </div>

  `).join('');


  return `

    <div class="page-top">

      <button
        type="button"
        class="back-home"
        id="backHomeFromCart"
      >
        ← Scanner
      </button>

    </div>


    <h2 class="section-title">
      🧺 Cart
    </h2>


    <div class="card">

      ${
        cart.length
          ? rows
          : '<p class="hint-small">Cart is empty — go back and scan items.</p>'
      }


      <div class="divider"></div>


      <div class="cart-total">

        <span>
          Total
        </span>

        <strong>
          ₹${total}
        </strong>

      </div>


      <div id="cartErr" class="msg warn"></div>


      <div class="action-row">

        <button
          class="btn btn-ghost"
          id="continueScanBtn"
        >
          ← Continue scanning
        </button>

        <button
          class="btn btn-primary"
          id="checkoutBtn"
          ${!cart.length ? 'disabled' : ''}
        >
          Complete sale
        </button>

      </div>

    </div>

  `;
}


/* =========================
   RECEIPT
========================= */

function renderReceiptView() {

  const r = lastReceipt;

  if (!r) {
    return '';
  }


  const rows = r.items.map(it => `

    <div class="cart-row">

      <div>

        <div class="name">
          ${it.name}
        </div>

        <div class="meta">
          ${round2(it.quantity_sold)}
          ${it.unit}
          × ₹${it.price}
        </div>

      </div>

      <span class="cart-sub">
        ₹${round2(it.total_amount)}
      </span>

    </div>

  `).join('');


  return `

    <h2 class="section-title">
      ✅ Sale complete
    </h2>


    <div class="card">

      ${rows}

      <div class="divider"></div>

      <div class="cart-total">

        <span>
          Total
        </span>

        <strong>
          ₹${round2(r.grand_total)}
        </strong>

      </div>

    </div>


    <button
      class="btn btn-primary btn-block"
      id="newSaleBtn"
    >
      + New sale
    </button>

  `;
}


/* =========================
   ADD TO CART
========================= */

function addToCart(p) {

  const existing = cart.find(
    c => c.barcode === p.barcode
  );


  const alreadyInCart = existing
    ? existing.quantity
    : 0;


  const qty = qtyDraft;


  if (qty + alreadyInCart > p.quantity) {

    showToast(
      `Only ${round2(p.quantity)} ${p.unit} of ${p.name} in stock${alreadyInCart ? ` (${alreadyInCart} already in cart)` : ''}.`,
      'warn'
    );

    return;
  }


  if (existing) {

    existing.quantity = round2(
      existing.quantity + qty
    );

  } else {

    cart.push({
      barcode: p.barcode,
      name: p.name,
      price: p.price,
      unit: p.unit,
      quantity: qty
    });

  }


  showToast(
    `Added ${qty} ${p.unit} of ${p.name} to cart.`,
    'ok'
  );


  qtyDraft = 1;
  activeProduct = null;

  render();
}


/* =========================
   CHECKOUT
========================= */

async function checkoutCart() {

  try {

    const receipt = await api('/checkout', {

      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        items: cart.map(c => ({
          barcode: c.barcode,
          quantity: c.quantity
        }))
      })

    });


    lastReceipt = receipt;

    cart = [];

    scanMode = 'receipt';


    showToast(
      'Sale complete.',
      'ok'
    );


    products = await api('/products');

    render();

  } catch (e) {

    const err = $('cartErr');

    if (err) {
      err.textContent = e.message;
    }

  }
}


/* =========================
   BARCODE HANDLER
========================= */

async function handleBarcode(code) {

  code = (code || '').trim();


  if (!code) {
    return;
  }


  try {

    const p = await api(
      '/product/' + encodeURIComponent(code)
    );


    const inCart = cart.find(
      c => c.barcode === p.barcode
    );


    if (inCart) {

      if (
        inCart.quantity + 1 > p.quantity
      ) {

        showToast(
          `Only ${round2(p.quantity)} ${p.unit} of ${p.name} in stock.`,
          'warn'
        );

        return;
      }


      inCart.quantity = round2(
        inCart.quantity + 1
      );


      showToast(
        `+1 ${p.name} — now ${inCart.quantity} in cart.`,
        'ok'
      );


      render();

      return;
    }


    openProduct(p);

  } catch (e) {

    showToast(
      'No product with that barcode yet.',
      'warn'
    );


    activeProduct = {
      __new: true,
      barcode: code
    };


    render();
  }
}


/* =========================
   OPEN PRODUCT
========================= */

function openProduct(p) {

  activeProduct = p;

  qtyDraft = 1;

  scanMode = 'scan';

  render();
}


/* =========================
   PRODUCT TICKET
========================= */

function renderTicket() {

  if (activeProduct.__new) {

    return `

      <div class="card ticket">

        <span class="tag">
          ${activeProduct.barcode}
        </span>

        <h3>
          New product
        </h3>

        <p class="hint-small">
          This barcode is not registered yet.
          Add the product once and it will match
          this barcode in future scans.
        </p>


        <label>
          Product name
        </label>

        <input
          id="npName"
          placeholder="e.g. Britannia Bread"
        >


        <div class="field-row">

          <div>

            <label>
              Category
            </label>

            <input
              id="npCategory"
              placeholder="e.g. Grocery"
            >

          </div>


          <div>

            <label>
              Unit
            </label>

            <input
              id="npUnit"
              placeholder="pc / kg / litre"
              value="pc"
            >

          </div>

        </div>


        <div class="field-row">

          <div>

            <label>
              Price (₹)
            </label>

            <input
              id="npPrice"
              type="number"
              step="0.01"
              placeholder="0"
            >

          </div>


          <div>

            <label>
              Opening stock
            </label>

            <input
              id="npStock"
              type="number"
              step="0.01"
              placeholder="0"
            >

          </div>

        </div>


        <div class="field-row">

          <div>

            <label>
              Low-stock alert at
            </label>

            <input
              id="npLow"
              type="number"
              step="0.01"
              placeholder="5"
              value="5"
            >

          </div>


          <div>

            <label>
              Expiry date (optional)
            </label>

            <input
              id="npExpiry"
              type="date"
            >

          </div>

        </div>


        <div id="npErr" class="msg warn"></div>


        <button
          class="btn btn-primary btn-block"
          id="npSaveBtn"
        >
          Save to register
        </button>

      </div>

    `;
  }


  const p = activeProduct;


  const low =
    Number(p.quantity) <=
    Number(p.low_stock_level);


  const exp =
    expiryStatus(p.expiry_date);


  return `

    <div class="card ticket">

      <span class="tag">
        ${p.barcode} · ${p.category || 'General'}
      </span>


      <h3>
        ${p.name}
      </h3>


      <div>

        ₹${p.price} per ${p.unit}

        ${
          low
            ? '<span class="badge low">low stock</span>'
            : ''
        }

        ${
          exp
            ? `<span class="badge exp">${exp.label}</span>`
            : ''
        }

      </div>


      <div class="divider"></div>


      <div class="hint-small">

        In stock:
        <strong>
          ${round2(p.quantity)} ${p.unit}
        </strong>

        ${
          p.expiry_date
            ? ` · Expires ${p.expiry_date}`
            : ''
        }

      </div>


      <div class="stepper">

        <button data-step="-1">
          –
        </button>

        <input
          id="qtyVal"
          type="number"
          step="0.01"
          value="${qtyDraft}"
        >

        <button data-step="1">
          +
        </button>

        <span class="u">
          ${p.unit}
        </span>

      </div>


      <div class="action-row">

        <button
          class="btn btn-good"
          data-act="restock"
        >
          Restock
        </button>

        <button
          class="btn btn-stamp"
          data-act="sell"
        >
          🧺 Add to cart
        </button>

      </div>


      <div class="expiry-note">

        Restocking?
        You can update the expiry date at
        the same time.

        <label>
          New expiry date (optional)
        </label>

        <input
          id="restockExpiry"
          type="date"
          value="${p.expiry_date || ''}"
        >

      </div>


      <div id="ticketMsg"></div>

    </div>

  `;
}


/* =========================
   EVENTS
========================= */

function attachEvents() {


  /* Home */

  const homeBarcodeBtn = $('homeBarcodeBtn');

  if (homeBarcodeBtn) {

    homeBarcodeBtn.addEventListener(
      'click',
      () => {

        currentTab = 'scan';

        document.body.className =
          'theme-scan';

        document.querySelectorAll('.tab-btn')
          .forEach(b => {

            b.classList.toggle(
              'active',
              b.dataset.tab === 'scan'
            );

          });

        refreshAndRender();

      }
    );

  }


  const homeAiBtn = $('homeAiBtn');

  if (homeAiBtn) {

    homeAiBtn.addEventListener(
      'click',
      () => {
        switchTab('vendorx');
      }
    );

  }

  const switchToVendorXBtn = $('switchToVendorXBtn');
  if (switchToVendorXBtn) {
    switchToVendorXBtn.addEventListener('click', () => {
      switchTab('vendorx');
    });
  }

  if (currentTab === 'vendorx') {
    attachVendorXEvents();
  }


  const homeBarcodeQuickBtn = $('homeBarcodeQuickBtn');

  if (homeBarcodeQuickBtn) {

    homeBarcodeQuickBtn.addEventListener(
      'click',
      () => homeBarcodeBtn?.click()
    );

  }


  document.querySelectorAll(
    '.home-screen [data-tab]'
  ).forEach(btn => {

    btn.addEventListener(
      'click',
      () => switchTab(btn.dataset.tab)
    );

  });


  /* Back Home */

  const backHomeBtn = $('backHomeBtn');

  if (backHomeBtn) {

    backHomeBtn.addEventListener(
      'click',
      () => {

        stopScanner();

        switchTab('home');

      }
    );

  }


  /* Back buttons for screens reached via notification bell / profile */

  const backFromAlertsBtn = $('backFromAlertsBtn');

  if (backFromAlertsBtn) {

    backFromAlertsBtn.addEventListener(
      'click',
      () => switchTab('home')
    );

  }


  const backFromHistoryBtn = $('backFromHistoryBtn');

  if (backFromHistoryBtn) {

    backFromHistoryBtn.addEventListener(
      'click',
      () => switchTab(screenOrigin === 'profile' ? 'profile' : 'home')
    );

  }


  const backFromRecommendationsBtn = $('backFromRecommendationsBtn');

  if (backFromRecommendationsBtn) {

    backFromRecommendationsBtn.addEventListener(
      'click',
      () => switchTab(screenOrigin === 'profile' ? 'profile' : 'home')
    );

  }


  /* Profile tab */

  const saveProfileNameBtn = $('saveProfileNameBtn');

  if (saveProfileNameBtn) {

    saveProfileNameBtn.addEventListener(
      'click',
      async () => {

        const nameInput = $('profileNameInput');

        const name = nameInput ? nameInput.value.trim() : '';

        if (name === '') {
          showToast('Name cannot be empty', 'warn');
          return;
        }

        try {

          await api('/update-profile', {

            method: 'POST',

            headers: {
              'Content-Type': 'application/json'
            },

            body: JSON.stringify({ name })

          });

          showToast('Name updated', 'ok');

          await refreshAndRender();

        } catch (e) {

          showToast(e.message, 'warn');

        }

      }
    );

  }


  const updatePasswordBtn = $('updatePasswordBtn');

  if (updatePasswordBtn) {

    updatePasswordBtn.addEventListener(
      'click',
      async () => {

        const currentPassword = $('profileCurrentPassword').value;
        const newPassword = $('profileNewPassword').value;
        const confirmPassword = $('profileConfirmPassword').value;

        if (newPassword === '' || confirmPassword === '') {
          showToast('New password fields are required', 'warn');
          return;
        }

        if (newPassword !== confirmPassword) {
          showToast('New password and confirmation do not match', 'warn');
          return;
        }

        try {

          await api('/change-password', {

            method: 'POST',

            headers: {
              'Content-Type': 'application/json'
            },

            body: JSON.stringify({
              current_password: currentPassword,
              new_password: newPassword,
              confirm_password: confirmPassword
            })

          });

          showToast('Password updated', 'ok');

          $('profileCurrentPassword').value = '';
          $('profileNewPassword').value = '';
          $('profileConfirmPassword').value = '';

        } catch (e) {

          showToast(e.message, 'warn');

        }

      }
    );

  }


  const profileHistoryBtn = $('profileHistoryBtn');

  if (profileHistoryBtn) {

    profileHistoryBtn.addEventListener(
      'click',
      () => {
        screenOrigin = 'profile';
        switchTab('history');
      }
    );

  }


  const profileTipsBtn = $('profileTipsBtn');

  if (profileTipsBtn) {

    profileTipsBtn.addEventListener(
      'click',
      () => {
        screenOrigin = 'profile';
        switchTab('recommendations');
      }
    );

  }


  const profileLogoutBtn = $('profileLogoutBtn');

  if (profileLogoutBtn) {

    profileLogoutBtn.addEventListener(
      'click',
      () => {
        window.location.href = '/logout';
      }
    );

  }


  const backHomeFromCart =
    $('backHomeFromCart');

  if (backHomeFromCart) {

    backHomeFromCart.addEventListener(
      'click',
      () => {

        scanMode = 'scan';

        render();

      }
    );

  }


  /* Camera */

  const startCam = $('startCamBtn');

  if (startCam) {
    startCam.addEventListener(
      'click',
      startScanner
    );
  }


  const stopCam = $('stopCamBtn');

  if (stopCam) {
    stopCam.addEventListener(
      'click',
      stopScanner
    );
  }


  /* Manual barcode */

  const manualGo = $('manualGoBtn');

  if (manualGo) {

    manualGo.addEventListener(
      'click',
      () => {

        handleBarcode(
          $('manualBarcode').value
        );

      }
    );

  }


  const manualInput = $('manualBarcode');

  if (manualInput) {

    manualInput.addEventListener(
      'keydown',
      e => {

        if (e.key === 'Enter') {

          e.preventDefault();

          manualGo.click();

        }

      }
    );

  }


  /* New product */

  const npSave = $('npSaveBtn');

  if (npSave) {

    npSave.addEventListener(
      'click',
      saveNewProduct
    );

  }


  /* Quantity stepper */

  document
    .querySelectorAll('.stepper button[data-step]')
    .forEach(b => {

      b.addEventListener(
        'click',
        () => {

          qtyDraft = round2(
            Math.max(
              0.01,
              qtyDraft + Number(b.dataset.step)
            )
          );

          $('qtyVal').value =
            qtyDraft;

        }
      );

    });


  const qtyValInput = $('qtyVal');

  if (qtyValInput) {

    qtyValInput.addEventListener(
      'input',
      () => {

        qtyDraft =
          Number(qtyValInput.value) || 0;

      }
    );

  }


  /* Product actions */

  document
    .querySelectorAll(
      '.action-row button[data-act]'
    )
    .forEach(b => {

      b.addEventListener(
        'click',
        () => {

          if (b.dataset.act === 'sell') {

            addToCart(activeProduct);

          } else {

            restockProduct();

          }

        }
      );

    });


  /* Cart */

  const openCartBtn =
    $('openCartBtn');

  if (openCartBtn) {

    openCartBtn.addEventListener(
      'click',
      () => {

        scanMode = 'cart';

        render();

      }
    );

  }


  const continueScanBtn =
    $('continueScanBtn');

  if (continueScanBtn) {

    continueScanBtn.addEventListener(
      'click',
      () => {

        scanMode = 'scan';

        render();

      }
    );

  }


  const checkoutBtn =
    $('checkoutBtn');

  if (checkoutBtn) {

    checkoutBtn.addEventListener(
      'click',
      checkoutCart
    );

  }


  document
    .querySelectorAll('.cart-remove')
    .forEach(b => {

      b.addEventListener(
        'click',
        () => {

          cart.splice(
            Number(b.dataset.idx),
            1
          );

          render();

        }
      );

    });


  const newSaleBtn =
    $('newSaleBtn');

  if (newSaleBtn) {

    newSaleBtn.addEventListener(
      'click',
      () => {

        lastReceipt = null;

        scanMode = 'scan';

        render();

      }
    );

  }


  /* Inventory */

  document
    .querySelectorAll(
      '.inv-item[data-barcode]'
    )
    .forEach(el => {

      el.addEventListener(
        'click',
        (e) => {

          if (e.target.classList.contains('del-btn')) {
            return;
          }

          currentTab = 'scan';

          document.body.className =
            'theme-scan';

          document.querySelectorAll('.tab-btn')
            .forEach(b => {

              b.classList.toggle(
                'active',
                b.dataset.tab === 'scan'
              );

            });

          handleBarcode(
            el.dataset.barcode
          );

        }
      );

    });

  // Delete button handlers
  document
    .querySelectorAll('.del-btn')
    .forEach(btn => {

      btn.addEventListener('click', async (e) => {

        e.stopPropagation();

        const productId = btn.dataset.id;
        const invItem = btn.closest('.inv-item');
        const productName = invItem.querySelector('.name')?.textContent || 'Product';

        if (confirm(`Delete "${productName}"? This action cannot be undone.`)) {

          try {

            await api(`/delete-product/${productId}`, {
              method: 'DELETE'
            });

            showToast('Product deleted successfully', 'success');

            await refreshAndRender();
            render();

          } catch (err) {

            showToast(err.message || 'Failed to delete product', 'error');

          }

        }

      });

    });


  const filterInput =
    $('invFilter');

  if (filterInput) {

    filterInput.addEventListener(
      'input',
      () => render()
    );

  }

  // History tab events
  if (currentTab === 'history') {
    attachHistoryEvents();
  }

  // Recommendations tab events
  if (currentTab === 'recommendations') {
    attachRecommendationEvents();
  }

}


function attachRecommendationEvents() {

  document.querySelectorAll('.rec-tab-btn').forEach(btn => {

    btn.addEventListener('click', () => {

      const tabName = btn.dataset.recTab;

      document.querySelectorAll('.rec-tab-btn').forEach(b => 
        b.classList.remove('active')
      );
      btn.classList.add('active');

      document.querySelectorAll('.rec-tab-content').forEach(tab => 
        tab.classList.remove('active')
      );

      const tabEl = $(tabName + 'Tab');
      if (tabEl) tabEl.classList.add('active');
    });
  });
}


/* =========================
   SAVE NEW PRODUCT
========================= */

async function saveNewProduct() {

  const name =
    $('npName').value.trim();


  const errEl =
    $('npErr');


  if (!name) {

    errEl.textContent =
      'Product name is required.';

    return;

  }


  try {

    await api('/add-product', {

      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({

        barcode:
          activeProduct.barcode,

        name,

        category:
          $('npCategory').value.trim(),

        unit:
          $('npUnit').value.trim() || 'pc',

        price:
          Number($('npPrice').value) || 0,

        quantity:
          Number($('npStock').value) || 0,

        low_stock_level:
          Number($('npLow').value) || 5,

        expiry_date:
          $('npExpiry').value || null

      })

    });


    showToast(
      'Product added to the register.',
      'ok'
    );


    products =
      await api('/products');


    const p =
      await api(
        '/product/' +
        encodeURIComponent(
          activeProduct.barcode
        )
      );


    openProduct(p);

  } catch (e) {

    errEl.textContent =
      e.message;

  }

}


/* =========================
   RESTOCK
========================= */

async function restockProduct() {

  const p =
    activeProduct;


  const qty =
    qtyDraft;


  const msgEl =
    $('ticketMsg');


  if (!qty || qty <= 0) {

    msgEl.innerHTML =
      `<div class="msg warn">
        Enter a quantity above zero.
      </div>`;

    return;

  }


  const expiryInput =
    $('restockExpiry');


  try {

    const result =
      await api('/restock', {

        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({

          barcode:
            p.barcode,

          quantity:
            qty,

          expiry_date:
            expiryInput
              ? expiryInput.value
              : null

        })

      });


    p.quantity =
      result.new_quantity;


    if (
      expiryInput &&
      expiryInput.value
    ) {

      p.expiry_date =
        expiryInput.value;

    }


    showToast(
      `Restocked ${qty} ${p.unit} of ${p.name}.`,
      'ok'
    );


    qtyDraft = 1;

    products =
      await api('/products');


    render();

  } catch (e) {

    msgEl.innerHTML =
      `<div class="msg warn">
        ${e.message}
      </div>`;

  }

}


/* =========================
   CAMERA SCANNER
========================= */

function playBeep() {

  try {

    const ctx =
      new (
        window.AudioContext ||
        window.webkitAudioContext
      )();


    const osc =
      ctx.createOscillator();


    const gain =
      ctx.createGain();


    osc.type =
      'square';


    osc.frequency.value =
      1500;


    gain.gain.setValueAtTime(
      0.15,
      ctx.currentTime
    );


    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + 0.12
    );


    osc.connect(gain);

    gain.connect(ctx.destination);

    osc.start();

    osc.stop(
      ctx.currentTime + 0.12
    );

  } catch (e) {}

}


function startScanner() {

  if (
    typeof Html5Qrcode ===
    'undefined'
  ) {

    showToast(
      'Scanner library failed to load.',
      'warn'
    );

    return;

  }


  cameraOn = true;

  render();


  html5QrCode =
    new Html5Qrcode(
      'reader',
      {
        verbose: false
      }
    );


  html5QrCode.start(

    {
      facingMode:
        'environment'
    },

    {

      fps: 12,

      qrbox: (vw, vh) => {

        const w =
          Math.floor(vw * 0.82);

        return {

          width: w,

          height:
            Math.floor(
              Math.min(
                vh * 0.45,
                w * 0.42
              )
            )

        };

      },

      aspectRatio: 1.6

    },


    decodedText => {

      stopScanner();

      if (
        navigator.vibrate
      ) {

        navigator.vibrate(70);

      }


      playBeep();


      showToast(
        `Scanned · ${decodedText}`,
        'ok'
      );


      handleBarcode(
        decodedText
      );

    },


    () => {}

  ).catch(() => {

    cameraOn = false;

    render();

    showToast(
      'Camera unavailable (permission denied or no camera found).',
      'warn'
    );

  });

}


function stopScanner() {

  if (html5QrCode) {

    html5QrCode
      .stop()
      .then(() => {

        html5QrCode.clear();

      })
      .catch(() => {});


    html5QrCode = null;

  }


  cameraOn = false;


  if (currentTab === 'scan') {

    render();

  }

}


/* =========================
   INVENTORY
========================= */

function renderInventoryTab() {

  const filter =
    ($('invFilter')?.value || '')
      .toLowerCase();


  const list =
    products.filter(p =>

      (
        p.name +
        ' ' +
        p.barcode
      )
      .toLowerCase()
      .includes(filter)

    );


  const rows =
    list.map(p => {

      const cls =
        p.quantity <= 0
          ? 'out'
          : p.quantity <= p.low_stock_level
            ? 'low'
            : '';


      const badge =
        p.quantity <= 0

          ? '<span class="badge out">out</span>'

          : p.quantity <= p.low_stock_level

            ? '<span class="badge low">low</span>'

            : '';


      const exp =
        expiryStatus(
          p.expiry_date
        );


      return `

        <div
          class="inv-item ${cls}"
          data-barcode="${p.barcode}"
          data-id="${p.id}"
        >

          <div style="flex:1">

            <div class="name">
              ${p.name}
            </div>

            <div class="meta">
              ${p.barcode}
              · ₹${p.price}/${p.unit}
            </div>

            ${badge}

            ${
              exp
                ? ` <span class="badge exp">${exp.label}</span>`
                : ''
            }

          </div>


          <div class="qty">
            ${round2(p.quantity)}
            ${p.unit}
          </div>

          <button
            class="del-btn"
            data-id="${p.id}"
            title="Delete product"
          >
            🗑️
          </button>

        </div>

      `;

    }).join('');


  return `

    <h2 class="section-title">
      📦 Inventory
    </h2>


    <div class="search-row">

      <input
        id="invFilter"
        placeholder="Search products or barcode..."
        value="${filter}"
      >

    </div>


    ${
      list.length
        ? rows
        : `
          <div class="empty-state">

            <h3>
              Nothing here yet
            </h3>

            <p class="hint-small">
              Scan a barcode to add your first product.
            </p>

          </div>
        `
    }

  `;
}


/* =========================
   ALERTS
========================= */

function renderAlertsTab() {

  const lowRows =
    lowStock.map(p => `

      <div
        class="inv-item ${p.quantity <= 0 ? 'out' : 'low'}"
        data-barcode="${p.barcode}"
      >

        <div style="flex:1">

          <div class="name">
            ${p.name}
          </div>

          <div class="meta">
            ${p.barcode}
            · alert at
            ${p.low_stock_level}
            ${p.unit}
          </div>

        </div>


        <div class="qty">
          ${round2(p.quantity)}
          ${p.unit}
        </div>

      </div>

    `).join('');


  const expRows =
    expiringSoon.map(p => `

      <div
        class="inv-item low"
        data-barcode="${p.barcode}"
      >

        <div style="flex:1">

          <div class="name">
            ${p.name}
          </div>

          <div class="meta">
            ${p.barcode}
            · ${round2(p.quantity)}
            ${p.unit} in stock
          </div>

        </div>


        <div class="qty">
          ${p.expiry_date}
        </div>

      </div>

    `).join('');


  return `

    <div class="page-top">

      <button
        type="button"
        class="back-home"
        id="backFromAlertsBtn"
      >
        ← Home
      </button>

      <div class="page-label">
        ALERTS
      </div>

    </div>


    <h2 class="section-title">
      🔔 Alerts
    </h2>


    <div class="alert-section">

      <h3>
        Low / out of stock
        (${lowStock.length})
      </h3>


      ${
        lowStock.length
          ? lowRows
          : `
            <p class="hint-small">
              Nothing low on stock right now.
            </p>
          `
      }

    </div>


    <div class="alert-section">

      <h3>
        Expiring within 14 days
        (${expiringSoon.length})
      </h3>


      ${
        expiringSoon.length
          ? expRows
          : `
            <p class="hint-small">
              Nothing expiring soon.
            </p>
          `
      }

    </div>

  `;
}


/* =========================
   DASHBOARD
========================= */

function renderDashboardTab() {

  if (!dashboard) {

    return `

      <h2 class="section-title">
        📊 Dashboard
      </h2>

      <p class="hint-small">
        Loading…
      </p>

    `;

  }


  const recentSales =
    sales
      .slice(0, 10)
      .map(s => `

        <div class="log-row">

          <div>

            <div class="l-name">
              ${s.name}
            </div>

            <div class="l-time">
              ${fmtTime(s.sale_date)}
            </div>

          </div>


          <span class="l-qty">
            ₹${round2(s.total_amount)}
          </span>

        </div>

      `)
      .join('');


  return `

    <h2 class="section-title">
      📊 Dashboard
    </h2>


    <div class="stat-grid">

      <div class="stat-card">

        <span class="num">
          ${dashboard.total_products}
        </span>

        <span class="lbl">
          Products tracked
        </span>

      </div>


      <div class="stat-card">

        <span class="num">
          ${round2(dashboard.total_stock)}
        </span>

        <span class="lbl">
          Total units in stock
        </span>

      </div>


      <div class="stat-card accent">

        <span class="num">
          ${dashboard.low_stock}
        </span>

        <span class="lbl">
          Low stock alerts
        </span>

      </div>


      <div class="stat-card warn">

        <span class="num">
          ${dashboard.expiring_soon}
        </span>

        <span class="lbl">
          Expiring soon
        </span>

      </div>


      <div class="stat-card">

        <span class="num">
          ₹${round2(dashboard.today_sales)}
        </span>

        <span class="lbl">
          Sold today
        </span>

      </div>


      <div class="stat-card">

        <span class="num">
          ₹${round2(dashboard.total_sales)}
        </span>

        <span class="lbl">
          Total sales
        </span>

      </div>

    </div>


    <h2
      class="section-title"
      style="font-size:1rem"
    >
      Recent sales
    </h2>


    ${
      sales.length
        ? recentSales
        : '<p class="hint-small">No sales yet.</p>'
    }

  `;
}


/* =========================
   STOCK HISTORY TAB
========================= */

function renderHistoryTab() {

  loadStockAnalytics();

  let historyHTML = `
    <section class="history-screen">

      <div class="page-top">

        <button
          type="button"
          class="back-home"
          id="backFromHistoryBtn"
        >
          ← Profile
        </button>

        <div class="page-label">
          HISTORY
        </div>

      </div>

      <div class="history-header">
        <h2>📜 Stock History & Analytics</h2>
        <p>Track all stock movements and view comprehensive analytics</p>
      </div>

      <!-- TAB SELECTOR -->
      <div class="history-tabs">
        <button class="hist-tab-btn active" data-hist-tab="movements">
          📋 Stock Movements
        </button>
        <button class="hist-tab-btn" data-hist-tab="analytics">
          📊 Analytics
        </button>
        <button class="hist-tab-btn" data-hist-tab="sales-analytics">
          💰 Sales Analytics
        </button>
      </div>

      <!-- STOCK MOVEMENTS TAB -->
      <div id="movementsTab" class="hist-tab-content active">
        <div class="section-title">Recent Stock Movements</div>
        <div id="movementsLoader" class="loader">Loading...</div>
        <div id="movementsContent"></div>
      </div>

      <!-- ANALYTICS TAB -->
      <div id="analyticsTab" class="hist-tab-content">
        <div class="section-title">Stock Analytics</div>
        <div id="analyticsLoader" class="loader">Loading...</div>
        <div id="analyticsContent"></div>
      </div>

      <!-- SALES ANALYTICS TAB -->
      <div id="salesAnalyticsTab" class="hist-tab-content">
        <div class="section-title">Sales Analytics</div>
        <div id="salesAnalyticsLoader" class="loader">Loading...</div>
        <div id="salesAnalyticsContent"></div>
      </div>

    </section>
  `;

  return historyHTML;
}


function loadStockAnalytics() {

  setTimeout(async () => {

    try {
      // Load stock analytics
      stockAnalytics = await api('/stock-analytics');
      renderStockAnalytics();

      // Load sales analytics
      salesAnalytics = await api('/sales-analytics');
      renderSalesAnalytics();

      // Load recent stock movements
      stockHistory = await api('/stock-history');
      renderStockMovements();

    } catch (e) {
      showToast('Error loading analytics: ' + e.message, 'warn');
    }

  }, 100);
}


// Handle window resize for responsive charts
window.addEventListener('resize', debounce(() => {
  if (currentTab === 'history' && stockAnalytics) {
    setTimeout(() => {
      renderStockAnalytics();
      renderSalesAnalytics();
    }, 100);
  }
}, 300));


function debounce(func, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}


function renderStockMovements() {

  const container = $('movementsContent');
  const loader = $('movementsLoader');

  if (!container) return;

  loader.style.display = 'none';

  if (!stockHistory || stockHistory.length === 0) {
    container.innerHTML = '<p class="hint-small">No stock movements yet.</p>';
    return;
  }

  let html = '<div class="movements-list">';

  stockHistory.slice(0, 50).forEach(move => {

    const actionColor = move.action === 'RESTOCK' ? '#10b981' : '#ef4444';
    const actionEmoji = move.action === 'RESTOCK' ? '📥' : '📤';
    const sign = move.action === 'RESTOCK' ? '+' : '-';

    html += `
      <div class="movement-item">
        <div class="movement-icon" style="color: ${actionColor}">${actionEmoji}</div>
        <div class="movement-info">
          <div class="movement-product">${move.name}</div>
          <div class="movement-time">${fmtTime(move.timestamp)}</div>
        </div>
        <div class="movement-qty">
          <div style="color: ${actionColor}; font-weight: bold">
            ${sign}${move.quantity} ${move.unit}
          </div>
          <div class="movement-action">${move.action}</div>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}


function renderStockAnalytics() {

  const container = $('analyticsContent');
  const loader = $('analyticsLoader');

  if (!container || !stockAnalytics) return;

  loader.style.display = 'none';

  let html = `
    <div class="analytics-grid">

      <!-- Daily Stock Movements Chart -->
      <div class="analytics-card">
        <h3>Daily Stock Movements</h3>
        <div class="chart-container"><canvas id="dailyMovementsChart" height="180"></canvas></div>
      </div>

      <!-- Category Distribution -->
      <div class="analytics-card">
        <h3>Stock by Category</h3>
        <div class="chart-container"><canvas id="categoryStockChart" height="180"></canvas></div>
      </div>

      <!-- Top 10 Products -->
      <div class="analytics-card">
        <h3>Top 10 Products by Quantity</h3>
        <div class="products-list">
  `;

  stockAnalytics.top_products.forEach((prod, idx) => {
    html += `
      <div class="product-item">
        <div class="rank">#${idx + 1}</div>
        <div class="prod-info">
          <div class="prod-name">${prod.name}</div>
          <div class="prod-cat">${prod.category || 'N/A'}</div>
        </div>
        <div class="prod-qty">${prod.quantity} ${prod.unit}</div>
      </div>
    `;
  });

  html += `
        </div>
      </div>

      <!-- Low Stock Products -->
      <div class="analytics-card">
        <h3>Low Stock Alert (Top 10)</h3>
        <div class="products-list">
  `;

  stockAnalytics.low_products.forEach((prod, idx) => {
    const stockPercent = (prod.quantity / prod.low_stock_level) * 100;
    html += `
      <div class="product-item warn">
        <div class="rank" style="color: #ef4444">⚠️</div>
        <div class="prod-info">
          <div class="prod-name">${prod.name}</div>
          <div class="prod-cat">${prod.category || 'N/A'}</div>
        </div>
        <div class="prod-qty" style="color: #ef4444">${prod.quantity} / ${prod.low_stock_level} ${prod.unit}</div>
      </div>
    `;
  });

  html += `
        </div>
      </div>

    </div>
  `;

  container.innerHTML = html;

  // Render charts after a brief delay
  setTimeout(() => {
    renderDailyMovementsChart();
    renderCategoryStockChart();
  }, 200);
}


function renderSalesAnalytics() {

  const container = $('salesAnalyticsContent');
  const loader = $('salesAnalyticsLoader');

  if (!container || !salesAnalytics) return;

  loader.style.display = 'none';

  let html = `
    <div class="analytics-grid">

      <!-- Daily Sales Chart -->
      <div class="analytics-card">
        <h3>Daily Sales Revenue</h3>
        <div class="chart-container"><canvas id="dailySalesChart" height="180"></canvas></div>
      </div>

      <!-- Weekly Sales Trend -->
      <div class="analytics-card">
        <h3>Weekly Sales Trend</h3>
        <div class="chart-container"><canvas id="weeklySalesChart" height="180"></canvas></div>
      </div>

      <!-- Top Selling Products -->
      <div class="analytics-card">
        <h3>Top 10 Selling Products</h3>
        <div class="products-list">
  `;

  salesAnalytics.top_sellers.forEach((prod, idx) => {
    html += `
      <div class="product-item">
        <div class="rank">#${idx + 1}</div>
        <div class="prod-info">
          <div class="prod-name">${prod.name}</div>
          <div class="prod-stat">${prod.total_sold} items sold | ₹${round2(prod.total_revenue)}</div>
        </div>
      </div>
    `;
  });

  html += `
        </div>
      </div>

      <!-- Category-wise Sales -->
      <div class="analytics-card">
        <h3>Sales by Category</h3>
        <div class="chart-container"><canvas id="categorySalesChart" height="180"></canvas></div>
      </div>

    </div>
  `;

  container.innerHTML = html;

  setTimeout(() => {
    renderDailySalesChart();
    renderWeeklySalesChart();
    renderCategorySalesChart();
  }, 200);
}


// Chart.js implementations
let chartInstances = {};

function destroyChart(canvId) {
  if (chartInstances[canvId]) {
    chartInstances[canvId].destroy();
    delete chartInstances[canvId];
  }
}

function renderDailyMovementsChart() {

  const canv = $('dailyMovementsChart');
  if (!canv || !stockAnalytics) return;

  destroyChart('dailyMovementsChart');

  const ctx = canv.getContext('2d');

  if (!stockAnalytics.daily_movements || stockAnalytics.daily_movements.length === 0) {
    ctx.fillStyle = '#9fb1c8';
    ctx.font = '14px DM Sans';
    ctx.textAlign = 'center';
    ctx.fillText('No data available', canv.width / 2, canv.height / 2);
    return;
  }

  const dates = [...new Set(stockAnalytics.daily_movements.map(m => m.date))];
  const restocks = dates.map(d => 
    stockAnalytics.daily_movements
      .filter(m => m.date === d && m.action === 'RESTOCK')
      .reduce((s, m) => s + m.total_qty, 0)
  );
  const sales = dates.map(d => 
    stockAnalytics.daily_movements
      .filter(m => m.date === d && m.action === 'SALE')
      .reduce((s, m) => s + m.total_qty, 0)
  );

  const isMobile = window.innerWidth < 480;

  chartInstances['dailyMovementsChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dates.map(d => isMobile ? d.slice(-5) : d),
      datasets: [
        {
          label: 'Restock',
          data: restocks,
          backgroundColor: '#10b981',
          borderColor: '#059669',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Sale',
          data: sales,
          backgroundColor: '#ef4444',
          borderColor: '#dc2626',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 10 } },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: isMobile ? 10 : 12 } } },
        x: { ticks: { font: { size: isMobile ? 10 : 12 } } }
      },
      plugins: {
        legend: { 
          display: true,
          labels: { font: { size: isMobile ? 10 : 12 }, padding: isMobile ? 8 : 15 }
        },
        filler: { propagate: true }
      }
    }
  });
}


function renderCategoryStockChart() {

  const canv = $('categoryStockChart');
  if (!canv || !stockAnalytics) return;

  destroyChart('categoryStockChart');

  const ctx = canv.getContext('2d');

  if (!stockAnalytics.category_stock || stockAnalytics.category_stock.length === 0) {
    ctx.fillStyle = '#9fb1c8';
    ctx.font = '14px DM Sans';
    ctx.textAlign = 'center';
    ctx.fillText('No category data', canv.width / 2, canv.height / 2);
    return;
  }

  const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
  const isMobile = window.innerWidth < 480;

  chartInstances['categoryStockChart'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: stockAnalytics.category_stock.map(c => isMobile ? c.category.slice(0, 8) : c.category),
      datasets: [{
        data: stockAnalytics.category_stock.map(c => c.product_count),
        backgroundColor: colors.slice(0, stockAnalytics.category_stock.length),
        borderColor: '#0a1627',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: isMobile ? 5 : 10 },
      plugins: {
        legend: { 
          position: isMobile ? 'bottom' : 'bottom',
          labels: { 
            font: { size: isMobile ? 10 : 12 },
            padding: isMobile ? 8 : 15
          }
        }
      }
    }
  });
}


function renderDailySalesChart() {

  const canv = $('dailySalesChart');
  if (!canv || !salesAnalytics) return;

  destroyChart('dailySalesChart');

  const ctx = canv.getContext('2d');

  if (!salesAnalytics.daily_sales || salesAnalytics.daily_sales.length === 0) {
    ctx.fillStyle = '#9fb1c8';
    ctx.font = '14px DM Sans';
    ctx.textAlign = 'center';
    ctx.fillText('No sales data', canv.width / 2, canv.height / 2);
    return;
  }

  const dates = salesAnalytics.daily_sales.map(s => s.date);
  const revenues = salesAnalytics.daily_sales.map(s => s.revenue);
  const isMobile = window.innerWidth < 480;

  chartInstances['dailySalesChart'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates.map(d => isMobile ? d.slice(-5) : d),
      datasets: [{
        label: 'Revenue (₹)',
        data: revenues,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderWidth: isMobile ? 1.5 : 2,
        fill: true,
        tension: 0.4,
        pointRadius: isMobile ? 3 : 4,
        pointBackgroundColor: '#10b981',
        pointBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 10 } },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: isMobile ? 10 : 12 } } },
        x: { ticks: { font: { size: isMobile ? 10 : 12 } } }
      },
      plugins: {
        legend: { 
          display: true,
          labels: { font: { size: isMobile ? 10 : 12 }, padding: isMobile ? 8 : 15 }
        }
      }
    }
  });
}


function renderWeeklySalesChart() {

  const canv = $('weeklySalesChart');
  if (!canv || !salesAnalytics) return;

  destroyChart('weeklySalesChart');

  const ctx = canv.getContext('2d');

  if (!salesAnalytics.weekly_sales || salesAnalytics.weekly_sales.length === 0) {
    ctx.fillStyle = '#9fb1c8';
    ctx.font = '14px DM Sans';
    ctx.textAlign = 'center';
    ctx.fillText('No weekly data', canv.width / 2, canv.height / 2);
    return;
  }

  const weeks = salesAnalytics.weekly_sales.map(s => s.week);
  const quantities = salesAnalytics.weekly_sales.map(s => s.items_sold);
  const revenues = salesAnalytics.weekly_sales.map(s => s.revenue);
  const isMobile = window.innerWidth < 480;

  chartInstances['weeklySalesChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weeks.map(w => isMobile ? 'W' + w.slice(-2) : w),
      datasets: [
        {
          label: 'Items',
          data: quantities,
          backgroundColor: '#3b82f6',
          borderColor: '#1e40af',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Revenue',
          data: revenues,
          backgroundColor: '#10b981',
          borderColor: '#059669',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 10 } },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: isMobile ? 10 : 12 } } },
        x: { ticks: { font: { size: isMobile ? 10 : 12 } } }
      },
      plugins: {
        legend: { 
          display: true,
          labels: { font: { size: isMobile ? 10 : 12 }, padding: isMobile ? 8 : 15 }
        }
      }
    }
  });
}


function renderCategorySalesChart() {

  const canv = $('categorySalesChart');
  if (!canv || !salesAnalytics) return;

  destroyChart('categorySalesChart');

  const ctx = canv.getContext('2d');

  if (!salesAnalytics.category_sales || salesAnalytics.category_sales.length === 0) {
    ctx.fillStyle = '#9fb1c8';
    ctx.font = '14px DM Sans';
    ctx.textAlign = 'center';
    ctx.fillText('No category sales', canv.width / 2, canv.height / 2);
    return;
  }

  const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
  const isMobile = window.innerWidth < 480;

  chartInstances['categorySalesChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: salesAnalytics.category_sales.map(c => isMobile ? c.category.slice(0, 8) : c.category),
      datasets: [{
        label: 'Revenue (₹)',
        data: salesAnalytics.category_sales.map(c => c.revenue),
        backgroundColor: colors.slice(0, salesAnalytics.category_sales.length),
        borderColor: '#0a1627',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: isMobile ? 5 : 10 } },
      indexAxis: isMobile ? 'y' : 'y',
      scales: {
        x: { beginAtZero: true, ticks: { font: { size: isMobile ? 10 : 12 } } },
        y: { ticks: { font: { size: isMobile ? 10 : 12 } } }
      },
      plugins: {
        legend: { display: true, labels: { font: { size: isMobile ? 10 : 12 } } }
      }
    }
  });
}


/* =========================
   HISTORY TAB EVENTS
========================= */

function attachHistoryEvents() {

  document.querySelectorAll('.hist-tab-btn').forEach(btn => {

    btn.addEventListener('click', () => {

      const tabName = btn.dataset.histTab;

      document.querySelectorAll('.hist-tab-btn').forEach(b => 
        b.classList.remove('active')
      );
      btn.classList.add('active');

      document.querySelectorAll('.hist-tab-content').forEach(tab => 
        tab.classList.remove('active')
      );

      const tabEl = $(tabName + 'Tab');
      if (tabEl) tabEl.classList.add('active');
    });
  });
}


/* =========================
   RECOMMENDATIONS TAB
========================= */

function renderRecommendationsTab() {

  loadRecommendations();

  let html = `
    <section class="recommendations-screen">

      <div class="page-top">

        <button
          type="button"
          class="back-home"
          id="backFromRecommendationsBtn"
        >
          ← Profile
        </button>

        <div class="page-label">
          SMART TIPS
        </div>

      </div>

      <div class="recommendations-header">
        <h2>💡 Smart Inventory Tips</h2>
        <p>AI-powered restock suggestions & inventory insights</p>
      </div>

      <!-- TAB SELECTOR -->
      <div class="recommendations-tabs">
        <button class="rec-tab-btn active" data-rec-tab="forecast">
          📋 Restock Recommendations
        </button>
        <button class="rec-tab-btn" data-rec-tab="classification">
          ⚡ Product Velocity
        </button>
      </div>

      <!-- FORECAST TAB -->
      <div id="forecastTab" class="rec-tab-content active">
        <div id="forecastLoader" class="loader">Loading forecast...</div>
        <div id="forecastContent"></div>
      </div>

      <!-- CLASSIFICATION TAB -->
      <div id="classificationTab" class="rec-tab-content">
        <div id="classificationLoader" class="loader">Loading classification...</div>
        <div id="classificationContent"></div>
      </div>

    </section>
  `;

  return html;
}


function loadRecommendations() {

  setTimeout(async () => {

    try {
      demandForecast = await api('/demand-forecast');
      renderForecastView();

      productClassification = await api('/product-classification');
      renderClassificationView();

    } catch (e) {
      showToast('Error loading recommendations: ' + e.message, 'warn');
    }

  }, 100);
}


function renderForecastView() {

  const container = $('forecastContent');
  const loader = $('forecastLoader');

  if (!container || !demandForecast) return;

  loader.style.display = 'none';

  if (!demandForecast.forecast_items || demandForecast.forecast_items.length === 0) {
    container.innerHTML = '<p class="hint-small">No forecast data available.</p>';
    return;
  }

  // Sort by urgency
  const sorted = demandForecast.forecast_items.sort((a, b) => {
    const urgencyMap = { high: 3, medium: 2, low: 1 };
    return urgencyMap[b.urgency] - urgencyMap[a.urgency];
  });

  let html = `
    <div class="forecast-summary">
      <div class="summary-card">
        <div class="summary-label">Overall Daily Avg</div>
        <div class="summary-value">${demandForecast.overall_daily_avg} items</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Products Tracked</div>
        <div class="summary-value">${demandForecast.total_products}</div>
      </div>
    </div>

    <h3 class="section-title">Restock Recommendations</h3>

    <div class="recommendations-list">
  `;

  sorted.slice(0, 20).forEach(item => {

    const urgencyColor = item.urgency === 'high' ? '#ef4444' : item.urgency === 'medium' ? '#f59e0b' : '#10b981';
    const urgencyText = item.urgency === 'high' ? '🔴 Critical' : item.urgency === 'medium' ? '🟡 Medium' : '🟢 Low';
    const statusEmoji = item.stock_status === 'critical' ? '⚠️' : '✅';

    html += `
      <div class="recommendation-card" style="border-left: 4px solid ${urgencyColor}">
        <div class="rec-header">
          <div class="rec-status">${statusEmoji}</div>
          <div class="rec-product">
            <div class="rec-name">${item.name}</div>
            <div class="rec-category">${item.category || 'N/A'}</div>
          </div>
          <div class="rec-urgency" style="color: ${urgencyColor}">${urgencyText}</div>
        </div>

        <div class="rec-stats">
          <div class="rec-stat-row">
            <span class="stat-label">Current Stock</span>
            <span class="stat-value">${item.current_stock} ${item.unit}</span>
          </div>
          <div class="rec-stat-row">
            <span class="stat-label">Daily Avg Sales</span>
            <span class="stat-value">${item.daily_avg_sales} ${item.unit}/day</span>
          </div>
          <div class="rec-stat-row">
            <span class="stat-label">Expected in 7 Days</span>
            <span class="stat-value">${item.forecast_7days} ${item.unit}</span>
          </div>
        </div>

        <div class="rec-action">
          <div class="recommend-box">
            <span class="recommend-label">💡 Recommended Restock:</span>
            <span class="recommend-qty" style="color: ${urgencyColor}">+${item.recommend_restock} ${item.unit}</span>
          </div>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}


function renderClassificationView() {

  const container = $('classificationContent');
  const loader = $('classificationLoader');

  if (!container || !productClassification) return;

  loader.style.display = 'none';

  if (!productClassification || productClassification.length === 0) {
    container.innerHTML = '<p class="hint-small">No classification data available.</p>';
    return;
  }

  // Group by classification
  const fastMoving = productClassification.filter(p => p.classification === 'fast-moving');
  const normal = productClassification.filter(p => p.classification === 'normal');
  const slowMoving = productClassification.filter(p => p.classification === 'slow-moving');

  let html = `
    <div class="classification-summary">
      <div class="class-card fast">
        <div class="class-emoji">⚡</div>
        <div class="class-info">
          <div class="class-name">Fast-Moving</div>
          <div class="class-count">${fastMoving.length} products</div>
        </div>
      </div>
      <div class="class-card normal">
        <div class="class-emoji">📦</div>
        <div class="class-info">
          <div class="class-name">Normal</div>
          <div class="class-count">${normal.length} products</div>
        </div>
      </div>
      <div class="class-card slow">
        <div class="class-emoji">🐢</div>
        <div class="class-info">
          <div class="class-name">Slow-Moving</div>
          <div class="class-count">${slowMoving.length} products</div>
        </div>
      </div>
    </div>
  `;

  // Fast-moving products
  if (fastMoving.length > 0) {
    html += '<h3 class="section-title">⚡ Fast-Moving (High Priority Restock)</h3>';
    html += '<div class="products-velocity-list">';
    fastMoving.slice(0, 10).forEach((prod, idx) => {
      html += `
        <div class="velocity-item fast">
          <div class="vel-rank">⚡${idx + 1}</div>
          <div class="vel-info">
            <div class="vel-name">${prod.name}</div>
            <div class="vel-stat">${prod.total_sold_30days} sold in 30 days | Velocity: ${prod.velocity_score}/day</div>
          </div>
          <div class="vel-stock">${prod.current_stock} ${prod.unit}</div>
        </div>
      `;
    });
    html += '</div>';
  }

  // Normal products
  if (normal.length > 0) {
    html += '<h3 class="section-title">📦 Normal Velocity Products</h3>';
    html += '<div class="products-velocity-list">';
    normal.slice(0, 8).forEach((prod, idx) => {
      html += `
        <div class="velocity-item normal">
          <div class="vel-rank">${idx + 1}</div>
          <div class="vel-info">
            <div class="vel-name">${prod.name}</div>
            <div class="vel-stat">${prod.total_sold_30days} sold in 30 days | Velocity: ${prod.velocity_score}/day</div>
          </div>
          <div class="vel-stock">${prod.current_stock} ${prod.unit}</div>
        </div>
      `;
    });
    html += '</div>';
  }

  // Slow-moving products
  if (slowMoving.length > 0) {
    html += '<h3 class="section-title">🐢 Slow-Moving (Review Stock Levels)</h3>';
    html += '<div class="products-velocity-list">';
    slowMoving.slice(0, 8).forEach((prod, idx) => {
      html += `
        <div class="velocity-item slow">
          <div class="vel-rank">🐢${idx + 1}</div>
          <div class="vel-info">
            <div class="vel-name">${prod.name}</div>
            <div class="vel-stat">${prod.total_sold_30days} sold in 30 days | Velocity: ${prod.velocity_score}/day</div>
          </div>
          <div class="vel-stock">${prod.current_stock} ${prod.unit}</div>
        </div>
      `;
    });
    html += '</div>';
  }

  container.innerHTML = html;
}


/* =========================
   PROFILE
========================= */

function renderProfileTab() {

  const displayName =
    profileUser && profileUser.name
      ? profileUser.name
      : '';

  const displayHandle =
    profileUser
      ? (profileUser.username || profileUser.email || profileUser.mobile || '')
      : '';

  return `

    <h2 class="section-title">
      👤 Profile
    </h2>


    <div class="card profile-card">

      <div class="profile-section-title">
        Account
      </div>

      <p class="hint-small">
        Signed in as ${displayHandle || 'you'}
      </p>

      <label>
        Name
      </label>

      <input
        id="profileNameInput"
        placeholder="Your name"
        value="${displayName}"
      >

      <button
        type="button"
        class="btn btn-primary btn-block"
        id="saveProfileNameBtn"
      >
        Save Changes
      </button>

    </div>


    <div class="card profile-card">

      <div class="profile-section-title">
        🔐 Security
      </div>

      <p class="hint-small">
        Change your account password
      </p>

      <label>
        Current password
      </label>

      <input
        id="profileCurrentPassword"
        type="password"
        placeholder="Current password"
        autocomplete="current-password"
      >

      <label>
        New password
      </label>

      <input
        id="profileNewPassword"
        type="password"
        placeholder="New password"
        autocomplete="new-password"
      >

      <label>
        Confirm new password
      </label>

      <input
        id="profileConfirmPassword"
        type="password"
        placeholder="Confirm new password"
        autocomplete="new-password"
      >

      <button
        type="button"
        class="btn btn-primary btn-block"
        id="updatePasswordBtn"
      >
        Update Password
      </button>

    </div>


    <div class="card profile-card profile-link-card" id="profileHistoryBtn">

      <div>
        <div class="profile-link-title">
          📜 View History
        </div>

        <p class="hint-small">
          Stock movements & sales analytics
        </p>
      </div>

      <div class="profile-link-arrow">
        →
      </div>

    </div>


    <div class="card profile-card profile-link-card" id="profileTipsBtn">

      <div>
        <div class="profile-link-title">
          💡 Smart Tips
        </div>

        <p class="hint-small">
          Restock suggestions & product velocity
        </p>
      </div>

      <div class="profile-link-arrow">
        →
      </div>

    </div>


    <button
      type="button"
      class="btn btn-block"
      id="profileLogoutBtn"
    >
      Log out
    </button>

  `;
}


/* =========================
   INITIALIZATION
========================= */

$('todayDate').textContent =
  new Date().toLocaleDateString(
    'en-IN',
    {
      weekday: 'long',
      day: '2-digit',
      month: 'long'
    }
  );


document.body.className =
  'theme-home';


document
  .querySelectorAll('.tab-btn')
  .forEach(b => {

    b.classList.toggle(
      'active',
      b.dataset.tab === 'home'
    );

  });


refreshAndRender();