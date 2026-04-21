# Production Deployment Guide

This guide provides instructions for deploying the WOL Manager on a Linux server using a Python virtual environment and `systemd`. This setup ensures the application runs reliably as a background service.

## Prerequisites

- A Linux server (e.g., Ubuntu, Debian, CentOS).
- Python 3.9+ and `pip` installed.
- `git` installed.
- A non-root user with `sudo` privileges.

## 1. Clone the Repository

First, clone the project to your home directory (or another suitable location).

```bash
git clone https://github.com/your-username/wol-manager.git
cd wol-manager
```

## 2. Create a Virtual Environment

Using a virtual environment isolates the application's dependencies from the system's Python packages.

```bash
# Create the virtual environment in a 'venv' directory
python3 -m venv venv

# Activate the environment
source venv/bin/activate
```

Your shell prompt should now be prefixed with `(venv)`, indicating that the virtual environment is active.

## 3. Install Dependencies

Install the required Python packages using `pip`.

```bash
pip install -r requirements.txt
```

## 4. Configure the Application

The application is configured using environment variables defined in a `.env` file.

1.  **Create the `.env` file:** Copy the provided example file.

    ```bash
    cp .env.example .env
    ```

2.  **Generate a Secret Key:** The `SECRET_KEY` is crucial for security (CSRF protection). Generate a strong, random key.

    ```bash
    # Generate a key and append it to the .env file
    echo "SECRET_KEY=$(python3 -c 'import os; print(os.urandom(24).hex())')" >> .env
    ```

3.  **Review and Edit `.env`:** Open the file and adjust settings if needed. For a `systemd` deployment, the defaults are usually fine.

    ```bash
    # Example .env for production
    FLASK_HOST=127.0.0.1
    FLASK_PORT=5000
    FLASK_DEBUG=false
    DEVICES_FILE=devices.json
    PING_TIMEOUT=2
    WOL_COOLDOWN_SECONDS=120
    # SECRET_KEY will be here from the previous step
    ```

    **Note:** `FLASK_HOST` is set to `127.0.0.1` (localhost) because the application will be accessed through a reverse proxy (like Nginx or Apache), not directly.

## 5. Configure Your Devices

Edit the `devices.json` file to add the computers you want to manage.

```bash
nano devices.json
```

Follow the format specified in the `README.md`.

## 6. Create a systemd Service File

`systemd` is the standard service manager on modern Linux distributions. Creating a service file will allow it to manage the WOL Manager, automatically starting it on boot and restarting it if it fails.

1.  **Create the service file:**

    ```bash
    sudo nano /etc/systemd/system/wol-manager.service
    ```

2.  **Add the following content:**

    Be sure to replace `YOUR_USERNAME` with your actual username and verify that the path to the `wol-manager` directory is correct.

    ```ini
    [Unit]
    Description=WOL Manager Application
    After=network.target

    [Service]
    User=YOUR_USERNAME
    Group=www-data
    WorkingDirectory=/home/YOUR_USERNAME/wol-manager
    ExecStart=/home/YOUR_USERNAME/wol-manager/venv/bin/waitress-serve --host=127.0.0.1 --port=5000 app:app
    Restart=always
    RestartSec=5s

    [Install]
    WantedBy=multi-user.target
    ```

    **Breakdown of the file:**
    - `Description`: A brief description of the service.
    - `User`: The user the service will run as.
    - `Group`: The group the service will run as. `www-data` is common for web services.
    - `WorkingDirectory`: The absolute path to the application's directory.
    - `ExecStart`: The command that starts the application. It uses the `waitress-serve` executable from the virtual environment.
    - `Restart`: Configures `systemd` to always restart the service if it stops.
    - `WantedBy`: Ensures the service starts at boot.

## 7. Start and Enable the Service

Now, you can use `systemctl` to manage the new service.

1.  **Reload the `systemd` daemon** to make it aware of the new file.

    ```bash
    sudo systemctl daemon-reload
    ```

2.  **Start the WOL Manager service.**

    ```bash
    sudo systemctl start wol-manager
    ```

3.  **Check the service status** to ensure it's running correctly.

    ```bash
    sudo systemctl status wol-manager
    ```

    If it's running, you should see output indicating it is `active (running)`. If there are errors, the log output will help you diagnose them. You can also view the logs with `sudo journalctl -u wol-manager`.

4.  **Enable the service to start on boot.**

    ```bash
    sudo systemctl enable wol-manager
    ```

## 8. Set Up a Reverse Proxy (Required)

This application is designed to run behind a password-protected reverse proxy. The proxy will handle HTTPS (SSL/TLS) and authentication, passing traffic to the WOL Manager running on `localhost:5000`.

Refer to the `README.md` for Nginx or Apache configuration examples. Setting up a reverse proxy is a critical security step and should not be skipped.

Your deployment is now complete! The WOL Manager will run as a background service and automatically start when the server boots.
