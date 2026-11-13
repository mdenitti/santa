const GA_MEASUREMENT_ID = 'G-HVDBDXBML3';
const GA_DISABLE_FLAG = 'ga-disable-' + GA_MEASUREMENT_ID;
const STORAGE_KEY = 'assurio_cookie_consent';

function readConsent() {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function writeConsent(value) {
    try {
        localStorage.setItem(STORAGE_KEY, value);
    } catch {
        // Ignore storage errors in private browsing
    }
}

export function initAnalytics() {
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
        return;
    }

    window.dataLayer = window.dataLayer || [];
    function gtag() {
        window.dataLayer.push(arguments);
    }
    window.gtag = gtag;

    const savedConsent = readConsent();
    gtag('consent', 'default', {
        analytics_storage: savedConsent === 'granted' ? 'granted' : 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied'
    });

    function loadGoogleAnalytics() {
        window[GA_DISABLE_FLAG] = false;
        if (document.getElementById('ga-script')) return;
        const script = document.createElement('script');
        script.id = 'ga-script';
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
        document.head.appendChild(script);
        gtag('js', new Date());
        gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
    }

    function clearAnalyticsCookies() {
        const names = ['_ga', '_ga_' + GA_MEASUREMENT_ID.replace('G-', ''), '_gid', '_gat'];
        const host = window.location.hostname;
        const domains = ['', host, '.' + host];
        const parts = host.split('.');
        if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
        names.forEach(name => {
            domains.forEach(domain => {
                document.cookie = name + '=; Max-Age=0; path=/' + (domain ? '; domain=' + domain : '');
            });
        });
    }

    function denyAnalytics() {
        window[GA_DISABLE_FLAG] = true;
        gtag('consent', 'update', { analytics_storage: 'denied' });
        clearAnalyticsCookies();
    }

    if (savedConsent === 'granted') {
        loadGoogleAnalytics();
        return;
    }
    if (savedConsent === 'denied') {
        window[GA_DISABLE_FLAG] = true;
        return;
    }

    if (document.getElementById('assurio-consent-notice') || !document.body) return;

    const banner = document.createElement('div');
    banner.id = 'assurio-consent-notice';
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookievoorkeuren');
    banner.innerHTML = `
        <div class="cookie-banner-content">
            <p class="cookie-banner-text">
                Wij gebruiken anonieme analyse-cookies (Google Analytics) om onze website te verbeteren.
                <a href="/privacy.html" class="cookie-banner-link">Lees onze privacyverklaring</a>.
            </p>
            <div class="cookie-banner-actions">
                <button type="button" class="cookie-banner-btn cookie-banner-btn-secondary" id="cookie-deny">Weigeren</button>
                <button type="button" class="cookie-banner-btn cookie-banner-btn-primary" id="cookie-accept">Accepteren</button>
            </div>
        </div>
    `;
    document.body.appendChild(banner);

    requestAnimationFrame(() => {
        setTimeout(() => banner.classList.add('visible'), 100);
    });

    function dismissBanner() {
        banner.classList.remove('visible');
        setTimeout(() => {
            if (banner.parentNode) banner.parentNode.removeChild(banner);
        }, 350);
    }

    const btnAccept = banner.querySelector('#cookie-accept');
    const btnDeny = banner.querySelector('#cookie-deny');
    if (btnAccept) {
        btnAccept.addEventListener('click', () => {
            writeConsent('granted');
            gtag('consent', 'update', { analytics_storage: 'granted' });
            loadGoogleAnalytics();
            dismissBanner();
        });
    }
    if (btnDeny) {
        btnDeny.addEventListener('click', () => {
            writeConsent('denied');
            denyAnalytics();
            dismissBanner();
        });
    }
}
