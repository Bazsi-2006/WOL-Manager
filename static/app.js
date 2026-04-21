/**
 * Wake-on-LAN Manager - Frontend JavaScript
 * Handles UI updates, status polling, and WOL requests
 */

const POLL_INTERVAL = 3000; // 3 seconds
const STATUS_ENDPOINT = '/api/status';
const HOSTS_ENDPOINT = '/api/hosts';
const WAKE_ENDPOINT = '/api/wake';

let hosts = [];
let pollIntervals = {};
let isPageVisible = true;

/**
 * Initialize theme toggle
 */
function initThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    
    const applyTheme = (isDark) => {
        if (isDark) {
            document.body.classList.add('dark-mode');
            document.body.classList.remove('light-mode');
            themeToggle.innerHTML = '☀️';
            themeToggle.title = 'Switch to light mode';
        } else {
            document.body.classList.add('light-mode');
            document.body.classList.remove('dark-mode');
            themeToggle.innerHTML = '🌙';
            themeToggle.title = 'Switch to dark mode';
        }
    };

    // Check for saved preference, default to light mode
    let isDarkMode = localStorage.getItem('darkMode') === 'true';
    applyTheme(isDarkMode);

    // Toggle theme on click
    themeToggle.addEventListener('click', () => {
        isDarkMode = !isDarkMode;
        localStorage.setItem('darkMode', isDarkMode);
        applyTheme(isDarkMode);
    });
}

// Track page visibility to stop/start polling
document.addEventListener('visibilitychange', () => {
    isPageVisible = !document.hidden;
    if (isPageVisible) {
        console.log('Page is visible, resuming polling');
        startPolling();
    } else {
        console.log('Page is hidden, stopping polling');
        stopPolling();
    }
});

/**
 * Load all hosts from backend and render them
 */
async function loadHosts() {
    try {
        const response = await fetch(HOSTS_ENDPOINT);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        hosts = await response.json();

        if (!Array.isArray(hosts) || hosts.length === 0) {
            document.getElementById('hosts').innerHTML =
                '<div class="loading">No devices configured. Edit devices.json to add devices.</div>';
            return;
        }

        renderHosts();
        startPolling();
    } catch (error) {
        console.error('Error loading hosts:', error);
        document.getElementById('hosts').innerHTML =
            `<div class="loading">Error loading devices: ${escapeHtml(error.message)}</div>`;
    }
}

/**
 * Render all host cards in the DOM
 */
function renderHosts() {
    const container = document.getElementById('hosts');
    container.innerHTML = '';

    for (const host of hosts) {
        const card = createHostCard(host);
        container.appendChild(card);
    }
}

/**
 * Create a single host card element
 */
function createHostCard(host) {
    const card = document.createElement('div');
    card.className = 'host-card';
    card.id = `host-${escapeHtml(host.name)}`;

    card.innerHTML = `
        <div class="host-name">${escapeHtml(host.name)}</div>
        <div class="host-details">
            <div class="host-info">
                <label>IP:</label>
                <span>${escapeHtml(host.ip)}</span>
            </div>
            <div class="host-info">
                <label>MAC:</label>
                <span>${escapeHtml(host.mac)}</span>
            </div>
        </div>
        <div class="status" id="status-${escapeHtml(host.name)}">
            Loading...
        </div>
        <button class="wake-button" id="btn-${escapeHtml(host.name)}"
                onclick="wakeHost('${escapeHtml(host.name)}')">
            Wake
        </button>
        <div class="error" id="error-${escapeHtml(host.name)}"></div>
    `;

    return card;
}

/**
 * Update the status display for a single host
 */
function updateHostStatus(hostname, status, inCooldown) {
    const statusEl = document.getElementById(`status-${hostname}`);
    const button = document.getElementById(`btn-${hostname}`);

    if (!statusEl || !button) {
        console.warn(`Elements not found for host ${hostname}`);
        return;
    }

    // Clear all status classes
    statusEl.classList.remove('online', 'offline', 'starting');

    if (inCooldown) {
        statusEl.className = 'status starting';
        statusEl.textContent = '⟳ Starting...';
        button.disabled = true;
        button.textContent = 'Waking...';
    } else if (status === 'online') {
        statusEl.className = 'status online';
        statusEl.textContent = '✓ Online';
        button.disabled = true;
        button.textContent = 'Wake';
    } else {
        statusEl.className = 'status offline';
        statusEl.textContent = '✗ Offline';
        button.disabled = false;
        button.textContent = 'Wake';
    }

    clearError(hostname);
}

/**
 * Check status of a single host
 */
async function checkStatus(hostname) {
    try {
        const response = await fetch(`${STATUS_ENDPOINT}/${escapeHtml(hostname)}`);
        if (response.ok) {
            const data = await response.json();
            updateHostStatus(hostname, data.status, data.in_cooldown);
        } else if (response.status === 404) {
            console.warn(`Host ${hostname} not found on server`);
        }
    } catch (error) {
        console.error(`Error checking status for ${hostname}:`, error);
    }
}

/**
 * Start polling for status of all hosts
 */
function startPolling() {
    for (const host of hosts) {
        if (!pollIntervals[host.name]) {
            // Check status immediately
            checkStatus(host.name);

            // Then set up recurring checks
            pollIntervals[host.name] = setInterval(() => {
                if (isPageVisible) {
                    checkStatus(host.name);
                }
            }, POLL_INTERVAL);

            console.log(`Started polling for ${host.name}`);
        }
    }
}

/**
 * Stop all polling
 */
function stopPolling() {
    for (const hostname in pollIntervals) {
        clearInterval(pollIntervals[hostname]);
        delete pollIntervals[hostname];
        console.log(`Stopped polling for ${hostname}`);
    }
}

/**
 * Display an error message for a host
 */
function showError(hostname, message) {
    const errorEl = document.getElementById(`error-${hostname}`);
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add('show');
    }
}

/**
 * Clear error message for a host
 */
function clearError(hostname) {
    const errorEl = document.getElementById(`error-${hostname}`);
    if (errorEl) {
        errorEl.classList.remove('show');
        errorEl.textContent = '';
    }
}

/**
 * Send Wake-on-LAN packet to a host
 */
async function wakeHost(hostname) {
    const button = document.getElementById(`btn-${hostname}`);
    const statusEl = document.getElementById(`status-${hostname}`);

    if (!button) {
        console.error(`Button not found for host ${hostname}`);
        return;
    }

    button.disabled = true;

    try {
        const response = await fetch(`${WAKE_ENDPOINT}/${escapeHtml(hostname)}`, {
            method: 'POST'
        });

        if (response.ok) {
            const data = await response.json();
            console.log(`WOL sent to ${hostname}:`, data.message);

            // Update UI to show "starting"
            updateHostStatus(hostname, 'offline', true);

            // After 2 minutes, check status again
            setTimeout(() => {
                console.log(`Cooldown finished for ${hostname}, checking status`);
                checkStatus(hostname);
            }, 2 * 60 * 1000);
        } else {
            const data = await response.json();
            const errorMsg = data.error || 'Unknown error';
            console.warn(`Failed to send WOL to ${hostname}: ${errorMsg}`);
            showError(hostname, `Error: ${errorMsg}`);
            button.disabled = false;
        }
    } catch (error) {
        console.error('Error sending WOL packet:', error);
        showError(hostname, `Error: ${error.message}`);
        button.disabled = false;
    }
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Stop polling when page unloads
 */
window.addEventListener('beforeunload', stopPolling);

/**
 * Initialize the app when page loads
 */
document.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();
    loadHosts();
});

// Also handle potential race condition
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initThemeToggle();
        loadHosts();
    });
} else {
    initThemeToggle();
    loadHosts();
}
