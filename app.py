#!/usr/bin/env python3
"""
Wake-on-LAN Manager Backend
Production-ready Flask app to manage Wake-on-LAN functionality.
"""

import json
import logging
import os
import platform
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from flask_wtf.csrf import CSRFProtect, CSRFError
from werkzeug.middleware.proxy_fix import ProxyFix
from wakeonlan import send_magic_packet
from waitress import serve

# --- Initial Setup ---

# Load environment variables from .env file
load_dotenv()


# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# --- Configuration ---

class Config:
    """Flask configuration from environment variables."""
    SECRET_KEY = os.getenv('SECRET_KEY', os.urandom(24))
    WTF_CSRF_ENABLED = os.getenv('WTF_CSRF_ENABLED', 'true').lower() == 'true'
    # Add a secure cookie prefix if running over HTTPS via reverse proxy
    SESSION_COOKIE_SECURE = os.getenv('SESSION_COOKIE_SECURE', 'true').lower() == 'true'
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'

# --- App Initialization ---

app = Flask(__name__)
app.config.from_object(Config)

# Enable CSRF protection
csrf = CSRFProtect(app)

# Apply ProxyFix if behind a reverse proxy
try:
    proxy_count = int(os.getenv('REVERSE_PROXY_COUNT', '0'))
    if proxy_count > 0:
        app.wsgi_app = ProxyFix(
            app.wsgi_app, x_for=proxy_count, x_proto=proxy_count, x_host=proxy_count, x_prefix=proxy_count
        )
        logger.info(f"ProxyFix enabled for {proxy_count} proxy/proxies.")
except ValueError:
    logger.error("Invalid REVERSE_PROXY_COUNT. Must be an integer.")
    sys.exit(1)

# --- Error Handling ---
@app.errorhandler(CSRFError)
def handle_csrf_error(e):
    return jsonify({'error': 'CSRF token missing or invalid.'}), 400

@app.errorhandler(404)
def not_found_error(error):
    return jsonify({'error': 'Not Found'}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Server Error: {error}")
    return jsonify({'error': 'Internal Server Error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    logger.error(f"An unhandled exception occurred: {e}", exc_info=True)
    return jsonify({'error': 'An unexpected error occurred'}), 500

# --- Global State & Constants ---

from waitress import serve

# --- Global State & Constants ---


# In-memory store for WOL cooldowns to prevent spamming
wol_cooldowns = {}

# Configuration from environment variables with safe defaults
try:
    DEVICES_FILE = Path(__file__).parent / os.getenv('DEVICES_FILE', 'devices.json')
    PING_TIMEOUT = int(os.getenv('PING_TIMEOUT', '2'))
    WOL_COOLDOWN_MINUTES = int(os.getenv('WOL_COOLDOWN_MINUTES', '2'))
    WOL_COOLDOWN_SECONDS = WOL_COOLDOWN_MINUTES * 60
except (ValueError, TypeError) as e:
    logger.error(f"Invalid environment variable: {e}. Please check your .env file.")
    sys.exit(1)

# --- Helper Functions ---

def load_config():
    """
    Load and validate device configuration from JSON file.
    Returns a tuple: (list_of_hosts, error_message).
    """
    if not DEVICES_FILE.is_file():
        return None, f"Configuration file not found at {DEVICES_FILE}"

    try:
        with open(DEVICES_FILE, 'r', encoding='utf-8') as f:
            devices = json.load(f)
    except json.JSONDecodeError as e:
        return None, f"Invalid JSON in {DEVICES_FILE}: {e}"
    except Exception as e:
        return None, f"Error reading {DEVICES_FILE}: {e}"

    if not isinstance(devices, list):
        return None, f"Configuration must be a JSON array of host objects."

    # Validate each device entry
    for i, device in enumerate(devices):
        if not isinstance(device, dict):
            return None, f"Device at index {i} must be a JSON object."
            
        required_keys = ['name', 'ip', 'mac']
        if not all(k in device for k in required_keys):
            return None, f"Device at index {i} is missing required keys: {', '.join(required_keys)}."

        if not all(isinstance(device.get(k), str) for k in required_keys):
             return None, f"Device at index {i} has invalid value types. 'name', 'ip', 'mac' must be strings."
        
        # Basic MAC address format validation
        mac = device.get('mac', '')
        if not (len(mac) == 17 and mac.count(':') == 5):
            return None, f"Device '{device.get('name')}' has a malformed MAC address: '{mac}'. Should be XX:XX:XX:XX:XX:XX."


    return devices, None


def is_online(ip: str, timeout: int = None) -> bool:
    """
    Check if a host is online by pinging it.
    Uses a platform-appropriate ping command.
    """
    timeout = timeout if timeout is not None else PING_TIMEOUT
    try:
        if platform.system() == 'Windows':
            command = ['ping', '-n', '1', '-w', str(timeout * 1000), ip]
        else:
            command = ['ping', '-c', '1', '-W', str(timeout), ip]

        result = subprocess.run(
            command,
            capture_output=True,
            check=False,
            timeout=timeout + 1
        )
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        logger.warning(f"Ping to {ip} timed out.")
        return False
    except Exception as e:
        logger.error(f"Error pinging {ip}: {e}")
        return False

# --- Security Headers ---

@app.after_request
def add_security_headers(response):
    """Add security headers to every response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    # A restrictive Content Security Policy
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "style-src 'self'; "
        "script-src 'self'; "
        "img-src 'self' data:; "
        "font-src 'self'; "
        "connect-src 'self';"
    )
    return response

from waitress import serve

# --- Initial Setup ---

# Load environment variables from .env file
load_dotenv()

# --- API Endpoints ---

@app.route('/')
def index():
    """Serve the main page."""
    return render_template('index.html', wol_cooldown_seconds=WOL_COOLDOWN_SECONDS)


@app.route('/api/hosts')
def get_hosts():
    """Get a sanitized list of all configured hosts."""
    config, error = load_config()
    if error:
        return jsonify({'error': error}), 500

    # Return only non-sensitive information
    sanitized_hosts = [{'name': host['name']} for host in config]
    return jsonify(sanitized_hosts)


@app.route('/api/status/<hostname>')
def get_status(hostname: str):
    """Get current status (online/offline) and cooldown state of a specific host."""
    config, error = load_config()
    if error:
        return jsonify({'error': error}), 500

    host = next((h for h in config if h['name'] == hostname), None)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    status = 'online' if is_online(host['ip']) else 'offline'
    in_cooldown = (hostname in wol_cooldowns and datetime.now() < wol_cooldowns[hostname])

    return jsonify({
        'name': hostname,
        'status': status,
        'in_cooldown': in_cooldown
    })


@app.route('/api/wake/<hostname>', methods=['POST'])
def wake_host(hostname: str):
    """Send a Wake-on-LAN packet to a host."""
    config, error = load_config()
    if error:
        return jsonify({'error': error}), 500

    host = next((h for h in config if h['name'] == hostname), None)
    if not host:
        return jsonify({'error': 'Host not found'}), 404

    if is_online(host['ip']):
        return jsonify({'error': 'Host is already online'}), 400

    if hostname in wol_cooldowns and datetime.now() < wol_cooldowns[hostname]:
        remaining = (wol_cooldowns[hostname] - datetime.now()).seconds
        return jsonify({
            'error': f'WOL already sent. Please wait {remaining} more seconds.'
        }), 429

    try:
        mac = host['mac']
        broadcast_ip = host.get('gateway', host.get('broadcast', '255.255.255.255'))
        port = int(host.get('port', 9))

        logger.info(f"Sending WOL to {hostname} (MAC: {mac}) via {broadcast_ip}:{port}")
        send_magic_packet(mac, ip_address=broadcast_ip, port=port)

        wol_cooldowns[hostname] = datetime.now() + timedelta(seconds=WOL_COOLDOWN_SECONDS)

        return jsonify({
            'success': True,
            'message': f'WOL packet sent to {hostname}.'
        })
    except Exception as e:
        logger.error(f"Failed to send WOL to {hostname}: {e}", exc_info=True)
        return jsonify({'error': f'Failed to send WOL packet: {e}'}), 500

# --- Main Execution ---

if __name__ == '__main__':
    host = os.getenv('FLASK_HOST', '127.0.0.1')
    port = int(os.getenv('FLASK_PORT', '5000'))
    debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'

    if debug:
        logger.warning("FLASK_DEBUG is enabled. Do not use in a production environment.")
        app.run(host=host, port=port, debug=True)
    else:
        logger.info(f"Starting production server on http://{host}:{port}")
        serve(app, host=host, port=port)
