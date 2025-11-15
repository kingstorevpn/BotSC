#!/bin/bash
  cd /root/BotSC
    timedatectl set-timezone Asia/Jakarta || echo -e "${red}Failed to set timezone to Jakarta${neutral}"

    if ! dpkg -s nodejs >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || echo -e "${red}Failed to download Node.js setup${neutral}"
        apt-get install -y nodejs || echo -e "${red}Failed to install Node.js${neutral}"
    else
        echo -e "${green}Node.js is already installed, skipping...${neutral}"
    fi

    if [ ! -f /root/BotSC/app.js ]; then
        git clone https://github.com/arivpnstores/BotSC.git /root/BotSC
    fi

npm install -g npm@latest
npm install -g pm2

    if ! npm list --prefix /root/BotSC express telegraf axios moment sqlite3 >/dev/null 2>&1; then
        npm install --prefix /root/BotSC sqlite3 express crypto telegraf axios dotenv
    fi

    if [ -n "$(ls -A /root/BotSC)" ]; then
        chmod +x /root/BotSC/*
    fi
wget -O /root/BotSC/ecosystem.config.js "https://raw.githubusercontent.com/arivpnstores/BotSC/main/ecosystem.config.js"
wget -O /root/BotSC/app.js "https://raw.githubusercontent.com/arivpnstores/BotSC/main/app.js"
# stop dulu servicenya
systemctl stop sellsc.service

# nonaktifkan supaya tidak jalan saat boot
systemctl disable sellsc.service

# hapus file service dari systemd
rm -f /etc/systemd/system/sellsc.service

# reload systemd biar bersih
systemctl daemon-reload
systemctl reset-failed


pm2 start ecosystem.config.js
pm2 save

cat >/usr/bin/backup_sellsc <<'EOF'
#!/bin/bash
# File: /usr/bin/backup_sellsc
# Pastikan chmod +x /usr/bin/backup_sellsc

VARS_FILE="/root/BotSC/.vars.json"
DB_FOLDER="/root/BotSC"

# Cek file .vars.json
if [ ! -f "$VARS_FILE" ]; then
    echo "❌ File $VARS_FILE tidak ditemukan"
    exit 1
fi

# Ambil nilai dari .vars.json
BOT_TOKEN=$(jq -r '.BOT_TOKEN' "$VARS_FILE")
USER_ID=$(jq -r '.USER_ID' "$VARS_FILE")

if [ -z "$BOT_TOKEN" ] || [ -z "$USER_ID" ]; then
    echo "❌ BOT_TOKEN atau USER_ID kosong di $VARS_FILE"
    exit 1
fi

# Daftar file database
DB_FILES=("sellvpn.db" "ressel.db" "trial.db")

for DB_FILE in "${DB_FILES[@]}"; do
    FILE_PATH="$DB_FOLDER/$DB_FILE"
    if [ -f "$FILE_PATH" ]; then
        curl -s -F chat_id="$USER_ID" \
             -F document=@"$FILE_PATH" \
             "https://api.telegram.org/bot$BOT_TOKEN/sendDocument" >/dev/null 2>&1
        echo "✅ $DB_FILE terkirim ke Telegram"
    else
        echo "❌ File $DB_FILE tidak ditemukan"
    fi
done

echo "✅ Semua backup selesai."
EOF

# bikin cron job tiap 1 jam
cat >/etc/cron.d/backup_sellsc <<'EOF'
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 0 * * * root /usr/bin/backup_sellsc
EOF

chmod +x /usr/bin/backup_sellsc
service cron restart
cd 