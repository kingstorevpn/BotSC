#!/bin/bash
wget -q https://raw.githubusercontent.com/kingstorevpn/v4/main/Fls/http -O /usr/bin/http
cekhttp=$(cat /usr/bin/http)

# Color definitions
DF='\e[39m'
Bold='\e[1m'
Blink='\e[5m'
yell='\e[33m'
red='\e[31m'
green='\e[32m'
blue='\e[34m'
PURPLE='\e[35m'
g="\e[36m"
gb='\033[0;37m'
NC='\e[0m'
cyan='\e[36m'
Lred='\e[91m'
Lgreen='\e[92m'
Lyellow='\e[93m'
GREEN='\033[0;32m'
ORANGE='\033[0;33m'
LIGHT='\033[0;37m'
RED='\033[0;31m'
GREEN='\033[0;32m'
ORANGE='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
LIGHT='\033[0;37m'

# Helper functions
purple() { echo -e "\\033[35;1m${*}\\033[0m"; }
tyblue() { echo -e "\\033[36;1m${*}\\033[0m"; }
yellow() { echo -e "\\033[33;1m${*}\\033[0m"; }
green() { echo -e "\\033[32;1m${*}\\033[0m"; }
red() { echo -e "\\033[31;1m${*}\\033[0m"; }

# Banner functions
function line_atas() {
    echo -e " ${CYAN}┌─────────────────────────────────────┐${NC}"
}

function line_bawah() {
    echo -e " ${CYAN}└─────────────────────────────────────┘${NC}"
}

function line_tengah() {
    echo -e " ${CYAN}┌─────────────────────────────────────•${NC}"
}

function line_tengh() {
    echo -e " ${CYAN}└─────────────────────────────────────•${NC}"
}

function ARI_Banner() {
    clear
    line_atas
    echo -e "\e[36m        .::. \033[0;35mKINGSTORE V4 \e[36m.::.        \033[0m"
    line_bawah
}

function ATAS() {
    echo -e "\033[0;35m             FEATURES ADMIN             \033[0m "
}

function Banner() {
    clear
    ARI_Banner
    line_atas
    ATAS
    line_bawah
}

# Function to check server IP and expiry
ipku=$(curl -sS ipv4.icanhazip.com)
ipsaya=$(curl -sS ipv4.icanhazip.com)
data_server=$(curl -v --insecure --silent https://google.com/ 2>&1 | grep Date | sed -e 's/< Date: //')
date_list=$(date +"%Y-%m-%d" -d "$data_server")
data_ip="https://raw.githubusercontent.com/kingstorevpn/izin/main/ip-admin"

checking_sc() {
    useexp=$(wget -qO- $data_ip | grep $ipsaya | awk '{print $3}')
    if [[ $date_list < $useexp ]]; then
        echo -ne
    else
        echo -e "\033[1;93m────────────────────────────────────────────\033[0m"
        echo -e "ANDA HARUS MENDAFTAR DAHULU UNTUK MENJADI RESSEL"
        echo -e "\033[1;93m────────────────────────────────────────────\033[0m"
        echo -e "            ${RED}DAFTAR DULU DEK !"
        echo -e "   \033[0;33mYour VPS $ipsaya \033[0;33mHas been Banned"
        echo -e "     \033[0;33mBuy access permissions for scripts"
        echo -e "             \033[0;33mContact Admin : @kingstorevpn"
        echo -e "      WhatsApp wa.me/"
        echo -e "\033[1;93m────────────────────────────────────────────\033[0m"
        exit
    fi
}
# Main script logic
#checking_sc
# GitHub repository details
REPO="https://github.com/-/izin.git"
TOKEN="-"
EMAIL="-@gmail.com"
USER="-"
CHATID="-"
KEY="-"
TIME="10"
URL="https://api.telegram.org/bot$KEY/sendMessage"

# Functions for managing IPs
update_repo() {
   # local commit_message="$1"
    cd /root/izin
    git config --global user.email "${EMAIL}"
    git config --global user.name "${USER}"
    rm -rf .git &> /dev/null
    git init &> /dev/null
    git add . &> /dev/null
    git commit -m "By ARIBOT" &> /dev/null
    git branch -M main &> /dev/null
    git remote add origin $REPO
    git push -f https://${TOKEN}@github.com/arivpnstores/izin.git &> /dev/null
    rm -rf /root/izin
}

send_telegram_notification() {
    local message="$1"
    curl -s --max-time $TIME -d "chat_id=$CHATID&disable_web_page_preview=1&text=$message&parse_mode=html" $URL >/dev/null
}

add_ip() {
    git clone $REPO /root/izin/ > /dev/null 2>&1
    read -p "Input IP Address: " ip
    CLIENT_EXISTS=$(grep -w $ip /root/izin/ip | wc -l)
    if [[ ${CLIENT_EXISTS} == '1' ]]; then
        echo "IP Already Exist!"
        rm -rf /root/izin
        exit 0
    fi
    read -p "Input username: " name
    read -p "Masukan waktu expired (days): " exp
    exp2=$(date -d "${exp} days" +"%Y-%m-%d")
    echo "### ${name} ${exp2} ${ip}" >> /root/izin/ip

    #update_repo "Add IP $ip"
    update_repo
    echo -e "\e[36mIP Address $ip has been successfully added."
      local message="
<code>◇━━━━━━━━━━━━━━◇</code>
<b>   ⚠️ ADD IP NOTIF ⚠️</b>
<b>Order by:</b> <code>$ipku</code>
<code>◇━━━━━━━━━━━━━━◇</code>
<b>IP:</b> <code>$ip</code>
<b>Username:</b> <code>$name</code>
<b>Expired:</b> <code>$exp2</code>
<code>◇━━━━━━━━━━━━━━◇</code>
"
    send_telegram_notification "$message"
    clear
echo -e "--------------"
echo -e "Name    : $name"
echo -e "IP      : $ip"
echo -e "Expired : $exp2"
echo -e "--------------"
echo -e "OS Support"
echo -e "☞ Ubuntu 20.04"
echo -e "--------------"
echo -e "1. Link Os Ubuntu 20.04 :"
echo -e "\`\`\`"
echo -e "apt update -y && wget https://raw.githubusercontent.com/bin456789/reinstall/main/reinstall.sh -O reinstall && chmod +x reinstall && bash reinstall ubuntu 20.04"
echo -e "\`\`\`"
echo -e "--------------"
echo -e "2. Link Install v4 (Ubuntu 20.04):"
echo -e "\`\`\`"
echo -e "apt update -y && apt install screen curl wget python3-pip -y && wget -q https://raw.githubusercontent.com/arivpnstores/install/main/v4.sh -O /tmp/install && chmod +x /tmp/install && screen -S ari /tmp/install"
echo -e "\`\`\`"
echo -e "--------------"
echo -e "If during the installation connection was lost, login to the vps again and run the command"
echo -e " ☞ screen -r ari or screen -d -r ari"
echo -e "--------------"
}

renew_ip() {
    git clone $REPO /root/izin/ > /dev/null 2>&1
    read -p "Input IP Address to renew: " ip
    CLIENT_EXISTS=$(grep -w $ip /root/izin/ip | wc -l)
    if [[ ${CLIENT_EXISTS} != '1' ]]; then
        echo "IP Address Not Found!"
        rm -rf /root/izin
        exit 0
    fi
    read -p "Input the number of days to renew: " days
    valid=$(grep -w $ip /root/izin/ip | awk '{print $3}')
    new_expiry_date=$(date -d "$valid +$days days" +"%Y-%m-%d")

    sed -i "/$ip/c\### $(grep -w $ip /root/izin/ip | awk '{print $2}') $new_expiry_date $ip" /root/izin/ip

    #update_repo "Renew IP $ip"
    update_repo
    echo -e "\e[36mStatus Success"
    echo -e "--------------"
    echo -e "IP   : $ip"
    echo -e "From : $valid"
    echo -e "To   : $new_expiry_date"
    echo -e "--------------"

    local message="
<code>◇━━━━━━━━━━━━━━◇</code>
<b>   ⚠️ RENEW IP NOTIF ⚠️</b>
<b>Order by:</b> <code>$ipku</code>
<code>◇━━━━━━━━━━━━━━◇</code>
<b>IP:</b> <code>$ip</code>
<b>Expired:</b> <code>$new_expiry_date</code>
<code>◇━━━━━━━━━━━━━━◇</code>
"
    send_telegram_notification "$message"
}

ganti_ip() {
    git clone $REPO /root/izin/ > /dev/null 2>&1
    read -p "Input Old IP Address: " old_ip
    CLIENT_EXISTS=$(grep -w $old_ip /root/izin/ip | wc -l)
    if [[ ${CLIENT_EXISTS} != '1' ]]; then
        echo "Old IP Address Not Found!"
        rm -rf /root/izin
        exit 0
    fi
    read -p "Input New IP Address: " new_ip

    # Ambil tanggal expired lama
    exp_old=$(grep -w $old_ip /root/izin/ip | awk '{print $3}')
    user_old=$(grep -w $old_ip /root/izin/ip | awk '{print $2}')

    # Hapus IP lama
    sed -i "/$old_ip/d" /root/izin/ip

    # Tambahkan IP baru dengan exp lama
    echo "### $user_old $exp_old $new_ip" >> /root/izin/ip

    update_repo

    echo -e "\e[36mStatus Success"
    echo -e "-----------------------------"
    echo -e "Old IP : $old_ip"
    echo -e "New IP : $new_ip"
    echo -e "Exp    : $exp_old"
    echo -e "-----------------------------"

    local message="
<code>◇━━━━━━━━━━━━━━◇</code>
<b>   🔄 GANTI IP NOTIF 🔄</b>
<b>Order by:</b> <code>$ipku</code>
<code>◇━━━━━━━━━━━━━━◇</code>
<b>Old IP:</b> <code>$old_ip</code>
<b>New IP:</b> <code>$new_ip</code>
<b>Expired:</b> <code>$exp_old</code>
<code>◇━━━━━━━━━━━━━━◇</code>
"
    send_telegram_notification "$message"
}

delete_ip() {
    git clone $REPO /root/izin/ > /dev/null 2>&1
    read -p "Input IP Address to delete: " ip
    CLIENT_EXISTS=$(grep -w $ip /root/izin/ip | wc -l)
    if [[ ${CLIENT_EXISTS} == '0' ]]; then
        echo "IP not found!"
        rm -rf /root/izin
        exit 0
    fi
    sed -i "/$ip/d" /root/izin/ip

    #update_repo "Delete IP $ip"
    update_repo
    echo -e "\e[36mIP Address $ip has been successfully deleted.\e[0m"

    local message="
<code>◇━━━━━━━━━━━━━━◇</code>
<b>   ⚠️ DELETE IP NOTIF ⚠️</b>
<b>Order by:</b> <code>$ipku</code>
<code>◇━━━━━━━━━━━━━━◇</code>
<b>IP:</b> <code>$ip</code>
<code>◇━━━━━━━━━━━━━━◇</code>
"
    send_telegram_notification "$message"
}

# Main menu
function Menu_fitur() {
    line_atas
    echo -e " ${g}│  ${gb}[01] • $NC ${g}ADD     IP SCRIPT"
    echo -e " ${g}│  ${gb}[02] • $NC ${g}RENEW   IP SCRIPT"
    echo -e " ${g}│  ${gb}[03] • $NC ${g}DELETE  IP SCRIPT"
    echo -e " ${g}│  ${gb}[04] • $NC ${g}GANTI   IP SCRIPT"
    line_bawah
    line_atas
    echo -e " ${g}│   ${gb}[b] • $NC ${g}Back to Menu"
    echo -e " ${g}│   ${gb}[x] • $NC ${g}EXIT"
    line_bawah
}

function Select_Menu() {
    read -p "Select From Options [1-7] :  " NB >/dev/null 2>&1
    case $NB in
        1) clear ; add_ip;;
        2) clear ; renew_ip;;
        3) clear ; delete_ip;;
        4) clear ; ganti_ip;;
        b) clear ; menu ;;
        x) exit ;;
        *) m-ftr-admin ;;
    esac
}

#Banner
#Menu_fitur
Select_Menu
