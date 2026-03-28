<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/platform-Raspberry%20Pi-c51a4a?style=for-the-badge&logo=raspberrypi&logoColor=white" alt="Raspberry Pi" />
  <img src="https://img.shields.io/badge/cast-Google%20Nest-4285F4?style=for-the-badge&logo=google-home&logoColor=white" alt="Google Nest" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="License" />
</p>

<h1 align="center">
  <br>
  Automatic Prayer Times
  <br>
  <sub>Adhan Player for Google Nest Hub</sub>
</h1>

<p align="center">
  <strong>Namaz vakitlerinde Google Nest Hub / Chromecast uzerinden otomatik ezan calan,<br>Raspberry Pi uzerinde 7/24 calisan akilli ezan sistemi.</strong>
</p>

<p align="center">
  <a href="#-ozellikler">Ozellikler</a> &bull;
  <a href="#-hizli-baslangic">Kurulum</a> &bull;
  <a href="#-web-dashboard">Dashboard</a> &bull;
  <a href="#-yapilandirma">Yapilandirma</a> &bull;
  <a href="#-raspberry-pi-kurulumu">Raspberry Pi</a> &bull;
  <a href="#-api-referansi">API</a>
</p>

---

## Ozellikler

| Ozellik | Aciklama |
|---------|----------|
| **Otomatik Ezan** | 5 vakit namaz icin tam saatinde ezan calar |
| **Google Cast** | Nest Hub, Chromecast ve diger Cast cihazlarina ses gonderir |
| **Diyanet API** | Namaz vakitlerini Diyanet'ten otomatik ceker — CSV'ye gerek yok |
| **Vakit Bazli Ses** | Her namaz icin farkli ezan dosyasi ve ses seviyesi |
| **Sabah Ozel Zamanlama** | Sabah ezani = Gunesogumu - 40 dakika |
| **Web Dashboard** | Tarayicidan yonetim paneli (Sacred Twilight tema) |
| **PWA Destegi** | Telefona ekle, uygulama gibi kullan |
| **CSV Destegi** | Turkce ve Ingilizce CSV formatlarini otomatik tanir |
| **Cihaz Testi** | Tek tikla bip sesi ile baglanti testi |
| **systemd Servisi** | Raspberry Pi'de acilista otomatik baslar |

---

## Hizli Baslangic

### 1. Kurulum

```bash
git clone https://github.com/yusufyildiz/automatic-prayer-times
cd automatic-prayer-times
npm install
```

### 2. Yapilandirma

```bash
cp config/config.example.json config/config.json
```

`config/config.json` dosyasini duzenleyin:

```jsonc
{
  "deviceIp": "192.168.1.100",   // Google Nest Hub IP adresi
  "volume": 0.7,                  // Genel ses seviyesi (0.0 - 1.0)
  "timezone": "Europe/Vienna",    // Saat dilimi
  "diyanetLocationId": 11618      // Diyanet konum ID (Viyana)
}
```

### 3. Ezan Dosyalari

MP3 dosyalarinizi `audio/` klasorune koyun:

```
audio/adhan.mp3           # Varsayilan ezan (tum vakitler)
audio/adhan-fajr.mp3      # Sabah ezani (istege bagli)
audio/adhan-dhuhr.mp3     # Ogle ezani (istege bagli)
...
```

### 4. Calistir

```bash
npm start
```

Dashboard'a erisim: **http://localhost:3000**

---

## Web Dashboard

Tarayici uzerinden tam kontrol saglayan yonetim paneli:

- Bugunun namaz vakitlerini ve bir sonraki ezani gorme
- Ses seviyesi ve yapilandirma ayarlarini degistirme
- Ezan ve CSV dosyalarini yukleme / silme
- Cihaz baglanti testi (bip sesi)
- Sistemi acma / kapatma
- Namaz vakitlerini Diyanet'ten yenileme

> **PWA**: Telefonunuzda tarayicidan "Ana ekrana ekle" yaparak uygulama gibi kullanabilirsiniz.

---

## Yapilandirma

### Tum Secenekler

| Secenek | Aciklama | Varsayilan |
|---------|----------|------------|
| `deviceIp` | Google Nest Hub IP adresi | **Zorunlu** |
| `deviceName` | Cihaz adi (referans icin) | `"Google Nest Hub"` |
| `volume` | Genel ses seviyesi (0.0 - 1.0) | `0.7` |
| `volumes` | Vakit bazli ses seviyeleri | `null` (genel ses kullanilir) |
| `timezone` | Saat dilimi | `"Europe/Vienna"` |
| `prayers` | Hangi vakitlerde ezan calinacak | Bes vakit |
| `adhanAudioFile` | Varsayilan ezan dosyasi | `"adhan.mp3"` |
| `audioFiles` | Vakit bazli ezan dosyalari | `null` |
| `csvFile` | CSV dosya adi (`data/` icinde) | `"prayer-times.csv"` |
| `diyanetLocationId` | Diyanet API konum ID | `11618` (Viyana) |
| `serverPort` | HTTP sunucu portu | `3000` |
| `localIp` | Lokal IP (otomatik algilanir) | `null` |

### Vakit Bazli Ses Seviyesi

```json
{
  "volumes": {
    "fajr": 0.29,
    "dhuhr": 0.54,
    "asr": 0.54,
    "maghrib": 0.54,
    "isha": 0.40
  }
}
```

### Vakit Bazli Ezan Dosyasi

```json
{
  "audioFiles": {
    "fajr": "adhan-fajr.mp3",
    "dhuhr": "adhan-dhuhr.mp3",
    "asr": "adhan-asr.mp3",
    "maghrib": "adhan-maghrib.mp3",
    "isha": "adhan-isha.mp3"
  }
}
```

---

## Namaz Vakitleri Kaynaklari

### Diyanet API (Onerilir)

Yapilandirmada `diyanetLocationId` ayarlayin — sistem vakitleri otomatik ceker ve her ayin 25'inde yeniler.

### CSV Dosyasi

Iki format desteklenir, sistem otomatik tanir:

**Turkce Format:**
```csv
Miladi Tarih,Imsak,Gunes,Ogle,Ikindi,Aksam,Yatsi
01 Ocak 2025,05:51,07:38,12:03,13:57,16:18,17:52
```

**Ingilizce Format:**
```csv
Date,Fajr,Sunrise,Dhuhr,Asr,Maghrib,Isha
2024-11-17,05:32,07:12,11:48,14:23,16:24,18:04
```

---

## Raspberry Pi Kurulumu

### Node.js 18+ Yukle

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### mDNS Bagimliligini Yukle

```bash
sudo apt-get install libavahi-compat-libdnssd-dev
```

### systemd Servisi Olarak Calistir

```bash
# Servis dosyasini kopyala
sudo cp adhan-player.service /etc/systemd/system/

# Yollari duzenle
sudo nano /etc/systemd/system/adhan-player.service

# Etkinlestir ve baslat
sudo systemctl daemon-reload
sudo systemctl enable adhan-player
sudo systemctl start adhan-player
```

### Servis Yonetimi

```bash
sudo systemctl status adhan-player        # Durum
sudo systemctl restart adhan-player       # Yeniden baslat
sudo journalctl -u adhan-player -f        # Canli loglar
```

---

## API Referansi

| Method | Endpoint | Aciklama |
|--------|----------|----------|
| `GET` | `/api/status` | Sistem durumu, vakitler, siradaki ezan |
| `GET` | `/api/prayer-times/today` | Bugunun namaz vakitleri |
| `GET` | `/api/config` | Yapilandirmayi oku |
| `PUT` | `/api/config` | Yapilandirmayi guncelle |
| `GET` | `/api/audio-files` | Ezan dosyalarini listele |
| `POST` | `/api/audio-files` | Ezan dosyasi yukle |
| `DELETE` | `/api/audio-files/:name` | Ezan dosyasi sil |
| `GET` | `/api/csv-files` | CSV dosyalarini listele |
| `POST` | `/api/csv-files` | CSV dosyasi yukle |
| `POST` | `/api/actions/test-cast` | Cihaz baglanti testi (bip) |
| `POST` | `/api/actions/fetch-times` | Diyanet'ten vakitleri cek |
| `POST` | `/api/actions/reschedule` | Bugunun ezanlarini yeniden planla |
| `POST` | `/api/actions/toggle-system` | Sistemi ac/kapat |

---

## Proje Yapisi

```
automatic-prayer-times/
├── src/
│   ├── index.js              # Ana giris noktasi & AdhanPlayer sinifi
│   ├── scheduler.js          # Cron zamanlayici (sabah = gunesogumu-40dk)
│   ├── cast.js               # Google Cast entegrasyonu
│   ├── csv-parser.js         # CSV okuyucu (TR & EN)
│   ├── server.js             # Express HTTP sunucu
│   ├── api-routes.js         # REST API endpointleri
│   ├── diyanet-fetcher.js    # Diyanet API baglantisi
│   └── prayer-history.js     # Ezan gecmisi
├── public/                   # Web dashboard (PWA)
│   ├── index.html
│   ├── css/style.css         # Sacred Twilight tema
│   ├── js/app.js
│   └── js/api.js
├── audio/                    # Ezan MP3 dosyalari
├── data/                     # Namaz vakitleri CSV
├── config/
│   ├── config.json           # Yapilandirma (gitignore'da)
│   └── config.example.json   # Ornek yapilandirma
├── adhan-player.service      # systemd servis dosyasi
└── package.json
```

---

## Sorun Giderme

<details>
<summary><strong>Cihaz bulunamiyor</strong></summary>

- Nest Hub ve cihazinizin ayni agda oldugundan emin olun
- IP adresini kontrol edin: `npm start -- --discover`
- Port 3000'in guvenlik duvarindan gectigini dogrulayin
</details>

<details>
<summary><strong>Ses calinmiyor</strong></summary>

- `audio/` klasorunde MP3 dosyasinin varligini kontrol edin
- Nest Hub'in sessize alinmadigini dogrulayin
- Dashboard'dan "Cihaz Testi" butonuyla bip sesi deneyin
</details>

<details>
<summary><strong>Vakitler yuklenmiyor</strong></summary>

- Diyanet API kullaniyorsaniz `diyanetLocationId` degerini kontrol edin
- CSV kullaniyorsaniz format ornekleriyle karsilastirin
- Dosya kodlamasinin UTF-8 oldugunu dogrulayin
</details>

---

## Lisans

MIT

---

<p align="center">
  <sub>Namazlariniz kabul olsun.</sub>
</p>
