#!/usr/bin/env python3
"""
Wake-on-LAN Manager Backend
Simple Flask app to manage Wake-on-LAN functionality
"""

from flask import Flask, render_template, jsonify, request
from wakeonlan import send_magic_packet
from dotenv import load_dotenv
import json
import subprocess
import platform
import threading
import os
from datetime import datetime, timedelta
from pathlib import Path

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Global state for WOL cooldowns - prevents accidental double-sends
wol_cooldowns = {}

# Configuration from environment variables
DEVICES_FILE = Path(__file__).parent / os.getenv('DEVICES_FILE', 'devices.json')
PING_TIMEOUT = int(os.getenv('PING_TIMEOUT', 2))
WOL_COOLDOWN_MINUTES = int(os.getenv('WOL_COOLDOWN_MINUTES', 2))


def load_config():
    """Load device configuration from JSON file"""
    try:
        with open(DEVICES_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: {DEVICES_FILE} not found")
        return []
    except json.JSONDecodeError as e:
        print(f"Error parsing {DEVICES_FILE}: {e}")
        return []


def is_online(ip, timeout=None):
    """
    Check if host is online by pinging it.
    Uses platform-appropriate ping command.
    """
    if timeout is None:
        timeout = PING_TIMEOUT
    try:
        if platform.system() == 'Windows':
            # Windows: ping -n 1 -w timeout_ms
            output = subprocess.run(
                ['ping', '-n', '1', '-w', str(timeout * 1000), ip],
                capture_output=True,
                timeout=timeout + 1
            )
        else:
            # Unix/Linux/Mac: ping -c 1 with timeout
            output = subprocess.run(
                ['ping', '-c', '1', ip],
                capture_output=True,
                timeout=timeout
            )
        return output.returncode == 0
    except subprocess.TimeoutExpired:
        return False
    except Exception as e:
        print(f"Error pinging {ip}: {e}")
        return False


@app.route('/')
def index():
    """Serve main page"""
    return render_template('index.html')


@app.route('/api/hosts')
def get_hosts():
    """Get list of all configured hosts"""
    config = load_config()
    return jsonify(config)


@app.route('/api/status/<hostname>')
def get_status(hostname):
    """Get current status of a specific host (online/offline) and cooldown state"""
    config = load_config()

    for host in config:
        if host['name'] == hostname:
            # Check if host is online
            status = 'online' if is_online(host['ip']) else 'offline'

            # Check if in WOL cooldown
            in_cooldown = (hostname in wol_cooldowns and
                          datetime.now() < wol_cooldowns[hostname])

            return jsonify({
                'name': hostname,
                'status': status,
                'in_cooldown': in_cooldown
            })

    return jsonify({'error': 'Host not found'}), 404


@app.route('/api/wake/<hostname>', methods=['POST'])
def wake_host(hostname):
    """Send a Wake-on-LAN packet to wake up a host"""
    config = load_config()

    for host in config:
        if host['name'] == hostname:
            # Check if host is already online
            if is_online(host['ip']):
                return jsonify({
                    'error': 'Host is already online, skipping WOL'
                }), 400

            # Check if in WOL cooldown (already sent recently)
            if hostname in wol_cooldowns and datetime.now() < wol_cooldowns[hostname]:
                return jsonify({
                    'error': 'WOL already sent, cooling down for 2 minutes'
                }), 429

            # Send WOL packet
            try:
                mac = host['mac']
                gateway = host['gateway']
                port = int(host.get('port', 9))

                send_magic_packet(mac, ip_address=gateway, port=port)

                # Set cooldown
                wol_cooldowns[hostname] = datetime.now() + timedelta(minutes=WOL_COOLDOWN_MINUTES)

                return jsonify({
                    'success': True,
                    'message': f'WOL packet sent to {hostname}'
                })
            except Exception as e:
                return jsonify({'error': f'Failed to send WOL: {str(e)}'}), 500

    return jsonify({'error': 'Host not found'}), 404


@app.route('/health')
def health():
    """Simple health check endpoint"""
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    # Read configuration from environment variables with defaults
    host = os.getenv('FLASK_HOST', '0.0.0.0')
    port = int(os.getenv('FLASK_PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'

    print(f"Starting WOL Manager on {host}:{port}")
    app.run(host=host, port=port, debug=debug)
