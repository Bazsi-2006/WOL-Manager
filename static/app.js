/**
 * Wake-on-LAN Manager - Frontend JavaScript
 * Handles UI updates, status polling, and WOL requests with CSRF protection.
 */

const POLL_INTERVAL_MS = 5000; // 5 seconds
const STATUS_ENDPOINT = '/api/status';
const HOSTS_ENDPOINT = '/api/hosts';
const WAKE_ENDPOINT = '/api/wake';

let hosts = [];
let pollIntervals = {};
let isPageVisible = true;
let wolCooldownSeconds = 120; // Default, will be updated from backend

/**
 * Main initialization function
 */
function main() {
    // Set cooldown from data attribute
    const container = document.querySelector('.container');
    if (container && container.dataset.wolCooldownSeconds) {
        wolCooldownSeconds = parseInt(container.dataset.wolCooldownSeconds, 10);
    }

    initThemeToggle();
    loadHosts();
    initVisibilityHandling();
}

/**
 * Initialize theme toggle functionality
 */
function initThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    if (!themeToggle) return;

    const applyTheme = (isDark) => {
        document.body.classList.toggle('dark-mode', isDark);
        document.body.classList.toggle('light-mode', !isDark);
        themeToggle.innerHTML = isDark ? '☀️' : '🌙';
        themeToggle.title = `Switch to ${isDark ? 'light' : 'dark'} mode`;
    };

    let isDarkMode = localStorage.getItem('darkMode') === 'true';
    applyTheme(isDarkMode);

    themeToggle.addEventListener('click', () => {
        isDarkMode = !isDarkMode;
        localStorage.setItem('darkMode', isDarkMode);
        applyTheme(isDarkMode);
    });
}

/**
 * Set up page visibility event listeners to control polling
 */
function initVisibilityHandling() {
    document.addEventListener('visibilitychange', () => {
        isPageVisible = !document.hidden;
        if (isPageVisible) {
            console.log('Page is visible, resuming polling.');
            startPolling();
        } else {
            console.log('Page is hidden, pausing polling.');
            stopPolling();
        }
    });
    window.addEventListener('beforeunload', stopPolling);
}

/**
 * Fetch the list of hosts from the backend and render them
 */
async function loadHosts() {
    const hostsContainer = document.getElementById('hosts');
    try {
        const response = await fetch(HOSTS_ENDPOINT);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `HTTP error! Status: ${response.status}` }));
            throw new Error(errorData.error || 'Failed to load hosts.');
        }
        hosts = await response.json();

        if (!Array.isArray(hosts) || hosts.length === 0) {
            hostsContainer.innerHTML = '<div class="loading">No devices configured. Edit devices.json to add them.</div>';
            return;
        }

        renderHosts();
        startPolling();
    } catch (error) {
        console.error('Error loading hosts:', error);
        hostsContainer.innerHTML = `<div class="loading">Error: ${escapeHtml(error.message)}</div>`;
    }
}

/**
 * Render all host cards into the DOM
 */
function renderHosts() {
    const container = document.getElementById('hosts');
    container.innerHTML = '';
    hosts.forEach(host => {
        const card = createHostCard(host);
        container.appendChild(card);
    });
}

/**
 * Create a single host card element
 * @param {object} host - The host object
 * @returns {HTMLElement} The card element
 */
function createHostCard(host) {
    const card = document.createElement('div');
    card.className = 'host-card';
    card.id = `host-${escapeHtml(host.name)}`;

    card.innerHTML = `
        <div class="host-name">${escapeHtml(host.name)}</div>
        <div class="status" id="status-${escapeHtml(host.name)}">
            <span class="status-icon"></span>
            <span class="status-text">Loading...</span>
        </div>
        <button class="wake-button" id="btn-${escapeHtml(host.name)}">
            Wake
        </button>
        <div class="error" id="error-${escapeHtml(host.name)}"></div>
    `;

    const wakeButton = card.querySelector('.wake-button');
    wakeButton.addEventListener('click', () => wakeHost(host.name));

    return card;
}

/**
 * Update the UI for a single host based on its status
 * @param {string} hostname - The name of the host
 * @param {string} status - 'online', 'offline', or 'starting'
 * @param {boolean} inCooldown - Whether the host is in a WOL cooldown period
 */
function updateHostStatus(hostname, status, inCooldown) {
    const statusEl = document.getElementById(`status-${hostname}`);
    const button = document.getElementById(`btn-${hostname}`);
    if (!statusEl || !button) return;

    const statusText = statusEl.querySelector('.status-text');
    statusEl.classList.remove('online', 'offline', 'starting');

    if (inCooldown) {
        statusEl.classList.add('starting');
        statusText.textContent = 'Starting...';
        button.disabled = true;
        button.textContent = 'Waking...';
    } else if (status === 'online') {
        statusEl.classList.add('online');
        statusText.textContent = 'Online';
        button.disabled = true;
        button.textContent = 'Wake';
    } else {
        statusEl.classList.add('offline');
        statusText.textContent = 'Offline';
        button.disabled = false;
        button.textContent = 'Wake';
    }
    clearError(hostname);
}

/**
 * Fetch the status of a single host from the backend
 * @param {string} hostname - The name of the host
 */
async function checkStatus(hostname) {
    try {
        const response = await fetch(`${STATUS_ENDPOINT}/${encodeURIComponent(hostname)}`);
        if (response.ok) {
            const data = await response.json();
            updateHostStatus(hostname, data.status, data.in_cooldown);
        } else if (response.status === 404) {
            console.warn(`Host ${hostname} not found on server.`);
            showError(hostname, 'Host not found.');
        } else {
            const errorData = await response.json().catch(() => ({}));
            showError(hostname, errorData.error || 'Status check failed.');
        }
    } catch (error) {
        console.error(`Error checking status for ${hostname}:`, error);
        showError(hostname, 'Network error.');
    }
}

/**
 * Start polling for the status of all hosts
 */
function startPolling() {
    stopPolling(); // Ensure no duplicate intervals
    hosts.forEach(host => {
        checkStatus(host.name); // Immediate check
        pollIntervals[host.name] = setInterval(() => {
            if (isPageVisible) {
                checkStatus(host.name);
            }
        }, POLL_INTERVAL_MS);
    });
}

/**
 * Stop all status polling
 */
function stopPolling() {
    for (const hostname in pollIntervals) {
        clearInterval(pollIntervals[hostname]);
    }
    pollIntervals = {};
}

/**
 * Send a Wake-on-LAN request to a host
 * @param {string} hostname - The name of the host
 */
async function wakeHost(hostname) {
    const button = document.getElementById(`btn-${hostname}`);
    if (!button || button.disabled) return;

    button.disabled = true;
    clearError(hostname);

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        const response = await fetch(`${WAKE_ENDPOINT}/${encodeURIComponent(hostname)}`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok) {
            console.log(`WOL sent to ${hostname}:`, data.message);
            updateHostStatus(hostname, 'offline', true); // UI shows "starting"

            // After cooldown, re-enable polling to check status
            setTimeout(() => {
                console.log(`Cooldown finished for ${hostname}, checking status.`);
                checkStatus(hostname);
            }, wolCooldownSeconds * 1000);
        } else {
            throw new Error(data.error || 'Unknown error occurred.');
        }
    } catch (error) {
        console.error('Error sending WOL packet:', error);
        showError(hostname, `Error: ${error.message}`);
        button.disabled = false; // Re-enable button on failure
    }
}

/**
 * Display an error message for a specific host
 * @param {string} hostname - The name of the host
 * @param {string} message - The error message to display
 */
function showError(hostname, message) {
    const errorEl = document.getElementById(`error-${hostname}`);
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add('show');
    }
}

/**
 * Clear the error message for a specific host
 * @param {string} hostname - The name of the host
 */
function clearError(hostname) {
    const errorEl = document.getElementById(`error-${hostname}`);
    if (errorEl) {
        errorEl.classList.remove('show');
        errorEl.textContent = '';
    }
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - The text to escape
 * @returns {string} The escaped text
 */
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- App Initialization ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
