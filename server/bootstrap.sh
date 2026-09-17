#!/usr/bin/env bash
set -euo pipefail

# Run once as root on an Ubuntu Tencent Cloud instance after DNS points to the server.
# Usage: DOMAIN=zwj.17design.fun EMAIL=you@example.com bash bootstrap.sh

: "${DOMAIN:?Set DOMAIN, e.g. zwj.17design.fun}"
: "${EMAIL:?Set the certificate renewal email}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null; then
  echo "This bootstrap script currently supports Ubuntu/Debian only." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl nginx certbot python3-certbot-nginx

if ! command -v node >/dev/null || [[ "$(node --version | sed 's/^v//' | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

id -u richart >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin richart
install -d -o richart -g richart -m 755 /opt/richart-clone/releases
install -d -o richart -g richart -m 700 /opt/richart-clone/data

cat >/etc/systemd/system/richart-clone.service <<'EOF'
[Unit]
Description=Richart Clone
After=network.target

[Service]
Type=simple
User=richart
Group=richart
WorkingDirectory=/opt/richart-clone/current
Environment=NODE_ENV=production
Environment=PORT=3100
ExecStart=/usr/bin/env npm start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/nginx/sites-available/richart-clone <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sfn /etc/nginx/sites-available/richart-clone /etc/nginx/sites-enabled/richart-clone
nginx -t
systemctl daemon-reload
systemctl enable --now nginx
systemctl enable richart-clone

# This only succeeds after zwj.17design.fun already resolves to this server.
certbot --nginx --non-interactive --agree-tos --email "$EMAIL" -d "$DOMAIN" --redirect
