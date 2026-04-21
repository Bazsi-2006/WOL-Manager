# Wake-on-LAN Manager

A lightweight, self-hosted web app for managing Wake-on-LAN across your local network. Built with Python 3.9 and Flask, designed to run behind a reverse proxy with external authentication.

## Features

- **Simple Web UI**: View all configured PCs and their status
- **Real-time Status Polling**: Check which PCs are online/offline with periodic pinging (only while page is open)
- **Wake-on-LAN Control**: Send WOL packets to offline machines
- **Intelligent Cooldown**: 2-minute wait after WOL to allow machines to boot before re-attempting
- **No Built-in Auth**: Designed for reverse proxy authentication (OAuth, LDAP, etc.)
- **Config-based**: No database required; manage PCs via JSON file
- **Cross-platform**: Works on Linux, macOS, and Windows

## Project Structure

```
wol-manager/
├── app.py                  # Flask backend
├── devices.json           # Device configuration (edit this)
├── .env.example           # Environment configuration template
├── requirements.txt       # Python dependencies
├── README.md             # This file
├── templates/
│   └── index.html        # Frontend HTML
└── static/
    ├── style.css         # UI styling
    └── app.js            # Frontend JavaScript
```

## Quick Start

### Prerequisites

- Python 3.9+
- pip
- Network access to your PCs (same subnet or WOL-capable network)

### Installation

1. **Clone or download this project**
   ```bash
   cd wol-manager
   ```

2. **Create a virtual environment (recommended)**
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment** - Copy the example file:
   ```bash
   cp .env.example .env
   # Edit .env to customize port, host, timeouts, etc.
   ```

5. **Configure your devices** - Edit `devices.json`:
   ```json
   [
     {
       "name": "Gaming PC",
       "ip": "192.168.1.50",
       "mac": "AA:BB:CC:DD:EE:FF",
       "gateway": "192.168.1.255",
       "port": "9"
     },
     {
       "name": "Workstation",
       "ip": "192.168.1.51",
       "mac": "11:22:33:44:55:66",
       "gateway": "192.168.1.255",
       "port": "9"
     }
   ]
   ```

6. **Run the app**
   ```bash
   python app.py
   ```
   The app will start on the host and port configured in `.env` (default: `http://localhost:5000`)

## Configuration

### Environment Settings (.env file)

The `.env` file controls application behavior. Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

Available settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `DEVICES_FILE` | `devices.json` | Path to device configuration file |
| `FLASK_HOST` | `0.0.0.0` | Server listen address (0.0.0.0 for all interfaces) |
| `FLASK_PORT` | `5000` | Server port number |
| `FLASK_DEBUG` | `false` | Debug mode (use false in production) |
| `PING_TIMEOUT` | `2` | Ping timeout in seconds |
| `WOL_COOLDOWN_MINUTES` | `2` | Cooldown duration in minutes after sending WOL |
| `REVERSE_PROXY_COUNT`| `0` | Number of trusted reverse proxies (see Reverse Proxy section) |


**Example .env for different scenarios:**

Development (local only, debug enabled):
```env
FLASK_HOST=127.0.0.1
FLASK_PORT=5000
FLASK_DEBUG=true
PING_TIMEOUT=2
```

Production (all interfaces, reverse proxy):
```env
FLASK_HOST=0.0.0.0
FLASK_PORT=5000
FLASK_DEBUG=false
PING_TIMEOUT=2
WOL_COOLDOWN_MINUTES=2
```

### Device Configuration (devices.json)

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name for the PC |
| `ip` | string | IP address for ping checks |
| `mac` | string | MAC address (colon-separated) |
| `gateway` | string | Broadcast address or gateway for WOL packet |
| `port` | string | WOL port (usually 9 or 7) |

### Example `devices.json`

```json
[
  {
    "name": "Gaming PC",
    "ip": "192.168.1.50",
    "mac": "AA:BB:CC:DD:EE:FF",
    "gateway": "192.168.1.255",
    "port": "9"
  },
  {
    "name": "Workstation",
    "ip": "192.168.1.51",
    "mac": "11:22:33:44:55:66",
    "gateway": "192.168.1.1",
    "port": "9"
  }
]
```

### Finding Your MAC Address

**Linux/macOS:**
```bash
ifconfig | grep "ether"
```

**Windows (PowerShell):**
```powershell
Get-NetAdapter | Select-Object Name, MacAddress
```

**From router admin panel:**
- Look at connected devices or DHCP lease list

## Usage

1. **Open the web interface**: Navigate to `http://your-server:5000`
2. **View PC status**: All configured PCs display with online/offline status
3. **Send WOL**:
   - If PC is offline: Click the "Wake" button
   - If PC is online: Button is disabled (no WOL sent)
4. **Automatic cooldown**: After sending WOL, the button locks for 2 minutes to allow boot
5. **Polling stops when idle**: Close the browser tab to stop polling (saves bandwidth)

## Reverse Proxy Setup

The app is designed to run behind a reverse proxy for authentication and SSL/TLS termination. Authentication is **not** built into the app itself.

To ensure the app correctly identifies the client's IP address and protocol, you must set the `REVERSE_PROXY_COUNT` environment variable in your `.env` file.

- **If you have one reverse proxy** (e.g., Nginx, Apache, Caddy), set `REVERSE_PROXY_COUNT=1`.
- **If you have multiple layers of proxies** (e.g., Cloudflare -> Nginx), set it to the total number of proxies (e.g., `REVERSE_PROXY_COUNT=2`).
- **If you are not using a reverse proxy**, leave it at the default of `REVERSE_PROXY_COUNT=0`.

This setting is critical for security, as it controls how many `X-Forwarded-For` and `X-Forwarded-Proto` headers are trusted.

### Nginx Example

```nginx
server {
    listen 80;
    server_name wol.example.com;

    # Add your auth module here (oauth2-proxy, Vouch, etc.)
    # Example with oauth2-proxy:
    auth_request /oauth2/auth;
    error_page 401 = /oauth2/sign_in;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Apache Example

```apache
<VirtualHost *:80>
    ServerName wol.example.com

    # Use your auth module (mod_oauth2, etc.)
    <Location />
        Require valid-user
    </Location>

    ProxyPreserveHost On
    ProxyPass / http://localhost:5000/
    ProxyPassReverse / http://localhost:5000/
</VirtualHost>
```

## Docker / Container Setup

When running in Docker, **WOL broadcast packets have special networking considerations**:

### Option 1: Host Network (Recommended)
Use `--network=host` so WOL packets can reach your subnet:
```bash
docker run --network=host -v $(pwd)/config.json:/app/config.json wol-manager
```

### Option 2: Macvlan Network
Create a macvlan network that bridges to your physical network:
```bash
docker network create -d macvlan --subnet=192.168.1.0/24 --gateway=192.168.1.1 -o parent=eth0 wol-net
docker run --network=wol-net -v $(pwd)/config.json:/app/config.json wol-manager
```

### Option 3: UDP Broadcast Helper
If above doesn't work, consider using `socat` on the host to forward WOL packets:
```bash
socat UDP-LISTEN:9,reuseaddr UDP-SENDTO:192.168.1.255:9
```

### Docker Compose Example

```yaml
version: '3.8'
services:
  wol-manager:
    build: .
    container_name: wol-manager
    network_mode: host  # Important for WOL broadcasts
    volumes:
      - ./devices.json:/app/devices.json:ro
      - ./.env:/app/.env:ro
    environment:
      FLASK_ENV: production
    restart: unless-stopped
```

### Dockerfile

```dockerfile
FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY devices.json .
COPY .env .env.example
COPY templates/ templates/
COPY static/ static/

EXPOSE 5000

CMD ["python", "app.py"]
```

## API Endpoints

### GET `/`
Serves the web UI.

### GET `/api/hosts`
Returns list of all configured hosts.
```json
[
  {
    "name": "Gaming PC",
    "ip": "192.168.1.50",
    "mac": "AA:BB:CC:DD:EE:FF",
    "gateway": "192.168.1.255",
    "port": "9"
  }
]
```

### GET `/api/status/<hostname>`
Returns current status and cooldown state of a host.
```json
{
  "name": "Gaming PC",
  "status": "online",
  "in_cooldown": false
}
```

**Status values:**
- `online`: Host is reachable
- `offline`: Host is not responding to ping

**in_cooldown values:**
- `true`: WOL was recently sent, cooldown in progress
- `false`: Normal operation

### POST `/api/wake/<hostname>`
Send WOL packet to a host.

**Success (200):**
```json
{
  "success": true,
  "message": "WOL packet sent to Gaming PC"
}
```

**Error cases:**
- `400`: Host is already online
- `404`: Host not found
- `429`: WOL already sent (cooldown in progress)
- `500`: Failed to send packet

### GET `/health`
Health check endpoint for load balancers.
```json
{
  "status": "ok"
}
```

## Behavior Details

### Status Polling
- Polling **only occurs while the web page is open** in a browser
- Polling stops when page is closed or tab becomes inactive
- Ping timeout is 2 seconds per host
- Polling interval is 3 seconds

### WOL Sending
1. PC must be offline to send WOL
2. WOL packet sent to `gateway` address on configured `port`
3. After sending, a 2-minute cooldown begins
4. During cooldown, status shows "Starting..." and button is disabled
5. After 2 minutes, normal polling resumes to check if PC came online

### Error Handling
- Network errors are logged but don't crash the app
- Invalid config.json shows error in UI
- Ping failures are silently treated as "offline"
- WOL packet send failures return error to user

## Troubleshooting

### "Host not found" error
- Check that hostname in `devices.json` matches exactly
- Ensure devices.json is valid JSON (check with `python -m json.tool devices.json`)

### WOL packet not reaching PC
1. **Check gateway address**: Should be broadcast address of your subnet (usually ends in .255)
2. **Check port**: Most PCs use port 9, some use port 7
3. **Enable WOL in BIOS**: Most systems have WOL disabled by default
4. **Router settings**: Some routers block broadcast packets
5. **Docker/container**: Make sure using `--network=host` or macvlan

### Ping not working
1. **Firewall**: Check PC firewall allows ICMP ping
2. **Network isolation**: PC might be on different VLAN
3. **IP address**: Verify IP address in config is correct

### Polling doesn't resume after boot
- Page must be actively open when PC comes online
- Automatic refresh happens every 3 seconds after cooldown ends
- Manually refresh browser if you want immediate update

## Performance

- Very lightweight - minimal CPU/memory usage
- No database needed
- Single JSON config file
- Ping checks typically < 100ms per host
- Suitable for self-hosting on Raspberry Pi or low-power hardware

## Security Notes

- **No built-in authentication**: Designed for reverse proxy (nginx, Apache, oauth2-proxy, etc.)
- **No HTTPS**: Use a reverse proxy for SSL/TLS termination.
- **CSRF Protection**: All state-changing requests are protected.
- **Secure Headers**: Includes Content-Security-Policy, X-Frame-Options, and Referrer-Policy.
- **Safe Reverse Proxy Handling**: Uses Werkzeug's `ProxyFix` to safely handle `X-Forwarded` headers when configured.
- All inputs are escaped to prevent XSS.
- Ping and WOL operations are safe; no shell injection possible.

## Limitations

- Only works on local network (or VPN'd subnet)
- Requires PCs to have WOL enabled in BIOS
- Polling is frontend-based (will stop if page is closed)
- No persistent logs (use container logs)

## Requirements

- **Python 3.9+**
- **Flask**
- **wakeonlan**
- **python-dotenv**
- **waitress**
- **Flask-WTF**

Dependencies are pinned in `requirements.txt` for stable, reproducible deployments.

## Development

To modify or extend:

1. **Backend**: Edit `app.py`
   - Add new endpoints
   - Modify WOL behavior
   - Change ping timeout

2. **Frontend**: Edit `templates/index.html`, `static/style.css`, `static/app.js`
   - Customize UI
   - Change polling interval
   - Add new UI features

3. **Testing**: Ensure devices.json is valid and hosts are reachable
   ```bash
   python -m json.tool devices.json
   ```

## License

Free to use, modify, and distribute.

## Support

For issues:
1. Check that devices.json is valid JSON
2. Verify .env file exists and is correctly configured
3. Verify PCs have WOL enabled
3. Test ping and WOL manually:
   ```bash
   ping 192.168.1.50
   # On Linux/Mac:
   python3 -c "from wakeonlan import send_magic_packet; send_magic_packet('AA:BB:CC:DD:EE:FF', '192.168.1.255')"
   ```
4. Check app logs for errors

---

**Happy waking!** 🌐