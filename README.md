<p align="center">
  <img src="ezan/logo.png" alt="Ezan Vakitleri" />
</p>

<h1 align="center">Ezan Vakitleri — Home Assistant Add-on</h1>

<p align="center">
  Diyanet namaz vakitlerinde ezanı otomatik okuyan Home Assistant add-on'u.<br>
  Ezanı bir <code>media_player</code>'a (Nest Hub, Sonos, …) veya Raspberry Pi'nin kendi ses çıkışına çalar,
  vakitleri MQTT üzerinden sensör olarak Home Assistant'a açar.
</p>

---

## Özellikler

- **Diyanet vakitleri** — `namazvakitleri.diyanet.gov.tr` konum sayfasından her gün 03:00'te çekilir, `/data` altında önbelleğe alınır. İnternet yokken en son çekilen vakitlerle çalışmaya devam eder (yıllık tablo + 30 günlük tablo → yılbaşında da veri olur).
- **Sabah ezanı güneş − 40 dk** (ayarlanabilir). İmsak ayrı bir vakit olarak açılıp kapatılabilir.
- **Vakit bazında açık/kapalı**, sabah için ayrı dosya ve ses seviyesi, isteğe bağlı Cuma öğle dosyası ve ezan duası.
- **İki çıkış modu:** `media_player` (HA'daki herhangi bir medya oynatıcı) veya `local` (Pi'nin ses çıkışı).
- **MQTT discovery** ile sensörler, susturma switch'leri ve butonlar — otomasyonlarda kullanılabilir.
- **Dayanıklı:** yeniden başlatmada o günün zamanlaması doğru kurulur, geçmiş/çalınmış ezan tekrar çalmaz; watchdog ile takılırsa yeniden başlatılır.

## Gereksinimler

- Home Assistant OS veya Supervised (test hedefi: Raspberry Pi 4, aarch64)
- **Mosquitto broker** add-on'u ve **MQTT** entegrasyonu (add-on `mqtt:need` ister)
- `media_player` modu için ezanı çalacak bir medya oynatıcı entity'si

## Kurulum

### A) GitHub deposu olarak (önerilen)

1. **Ayarlar → Eklentiler (Add-ons / Apps) → Eklenti Mağazası**
2. Sağ üstte **⋮ → Depolar (Repositories)**
3. Şu adresi ekleyin:
   ```
   https://github.com/yusufyildiz/automatic-prayer-times
   ```
4. Listede çıkan **Ezan Vakitleri** add-on'unu açın → **Yükle**.
   İmaj Pi üzerinde derlenir, birkaç dakika sürebilir.

### B) Yerel add-on olarak

1. **Samba share** veya **Advanced SSH & Web Terminal** add-on'u ile Home Assistant'a bağlanın.
2. Bu depodaki `ezan/` klasörünü olduğu gibi `/addons/ezan/` olarak kopyalayın
   (Samba'da `addons` paylaşımı). Sonuç: `/addons/ezan/config.yaml`, `/addons/ezan/Dockerfile`, …
3. **Eklenti Mağazası → ⋮ → Güncellemeleri denetle**.
4. **Yerel eklentiler (Local add-ons)** bölümünde **Ezan Vakitleri** → **Yükle**.

### Ses dosyalarını koyun

Add-on ilk açılışta `/media/ezan/` klasörünü oluşturur (içine test için `beep.wav` koyar).
Ezan MP3'lerinizi Samba (`media` paylaşımı) veya **Medya → Yerel Medya → Yükle** ile buraya kopyalayın:

```
/media/ezan/adhan.mp3
/media/ezan/adhan-sabah.mp3      (isteğe bağlı)
```

### Başlatın

1. **Yapılandırma** sekmesinde en azından `media_player_entity` değerini girin (veya `output_mode: local`).
2. **Başlat**. **Günlük (Log)** sekmesinde zamanlamayı görürsünüz:
   ```
   [00:01:00] 📅 2026-11-25 zamanlaması (şu an 00:01:00, Europe/Vienna):
   [00:01:00]    Sabah   06:29 (güneş 07:09 - 40 dk) — zamanlandı (6 sa 28 dk sonra)
   [00:01:00]    Öğle    11:46 — zamanlandı (11 sa 45 dk sonra)
   ...
   [00:01:00] ⏭️  Sonraki ezan: Sabah 06:29 — 6 sa 28 dk sonra
   ```
3. **Watchdog**'u açık bırakın.
4. Kurulumu test etmek için `button.ezan_test`'e basın. Seçili çıkışta %30 seviyesinde kısa bir bip sesi çalar.

## Ayarlar

| Ayar | Varsayılan | Açıklama |
|---|---|---|
| `location_id` | `11618` | Diyanet konum kimliği. [namazvakitleri.diyanet.gov.tr](https://namazvakitleri.diyanet.gov.tr)'de şehri seçince adreste görünen sayı (`/tr-TR/11618/viyana-icin-namaz-vakti` → `11618`). |
| `timezone` | `Europe/Vienna` | Saat dilimi |
| `output_mode` | `media_player` | `media_player` veya `local` |
| `media_player_entity` | — | Ör. `media_player.mutfak_nest_hub` (`media_player` modunda zorunlu) |
| `volume` | `0.5` | Genel ses seviyesi, 0.0–1.0 |
| `audio_file` | `adhan.mp3` | `/media/ezan/` içindeki dosya |
| `imsak` | `false` | İmsak saatinde ezan |
| `sabah` | `true` | Sabah ezanı (güneş − `fajr_offset`) |
| `ogle`, `ikindi`, `aksam`, `yatsi` | `true` | Vakit bazında açık/kapalı |
| `fajr_offset` | `40` | Sabah ezanı güneşten kaç dk önce; `0` = imsakta |
| `fajr_audio_file` | — | İmsak + sabah için ayrı dosya |
| `fajr_volume` | — | İmsak + sabah için ayrı ses seviyesi |
| `friday_audio_file` / `friday_volume` | — | Cuma öğle ezanı için dosya / ses |
| `dua_audio_file` / `dua_volume` | — | Her ezandan sonra çalınacak dua |

İsteğe bağlı ayarlar, Yapılandırma sekmesinde **"Kullanılmayan isteğe bağlı seçenekleri göster"** ile görünür.

### Çıkış modları

**`media_player`** — Add-on, Home Assistant API üzerinden önce `media_player.volume_set` ve `media_player.play_media` çağırır.
Dosyayı `media-source://media_source/local/ezan/<dosya>` olarak gönderir. Bu adresi Home Assistant kendi yerel URL'sine çevirir,
yani hoparlörün add-on container'ına erişmesi gerekmez. Add-on ezan bitene kadar oynatıcının durumunu takip eder.
Ezan bitince hoparlörün önceki ses seviyesini geri yükler. Başarısız olursa 5 sn arayla 3 kez dener.

> Google Cast cihazları için **Ayarlar → Sistem → Ağ → Home Assistant URL → Yerel ağ** adresi
> hoparlörün erişebileceği bir `http://<pi-ip>:8123` olmalıdır.

**`local`** — Pi'nin kendi ses çıkışında (3.5 mm jak / HDMI / USB ses kartı, Supervisor'un PulseAudio'su üzerinden) çalar.
MP3 dosyaları `mpg123`, WAV/OGG/FLAC dosyaları `paplay` ile çalınır. Çıkış cihazı, add-on sayfasındaki **Ses** bölümünden seçilir.

## Oluşan entity'ler

Hepsi **Ezan** cihazı altında, MQTT discovery ile oluşur:

| Entity | Tür | Açıklama |
|---|---|---|
| `sensor.ezan_imsak` | timestamp | Bugünün imsak vakti |
| `sensor.ezan_gunes` | timestamp | Güneş |
| `sensor.ezan_ogle` | timestamp | Öğle |
| `sensor.ezan_ikindi` | timestamp | İkindi |
| `sensor.ezan_aksam` | timestamp | Akşam |
| `sensor.ezan_yatsi` | timestamp | Yatsı |
| `sensor.ezan_sabah` | timestamp | Sabah ezanının okunacağı saat (güneş − ofset) |
| `sensor.ezan_sonraki_vakit` | timestamp | Sıradaki Diyanet vakti (imsak/güneş/öğle/ikindi/akşam/yatsı). Öznitelikler: `vakit`, `saat`, `tarih` |
| `sensor.ezan_sonraki_ezan` | timestamp | Gerçekten çalacak bir sonraki ezan (kapalı/susturulmuş olanlar hariç) |
| `sensor.ezan_son_calan` | metin | Son ezan ve durumu (`çalındı`, `atlandı`, `hata`, `durduruldu`) |
| `switch.ezan_sustur` | switch | Açıkken **hiçbir** ezan çalmaz |
| `switch.ezan_sustur_imsak` … `switch.ezan_sustur_yatsi` | switch | Vakit bazında susturma (`_imsak`, `_sabah`, `_ogle`, `_ikindi`, `_aksam`, `_yatsi`) |
| `button.ezan_test` | button | Hoparlör testi (bip, %30) |
| `button.ezan_durdur` | button | Çalan ezanı durdur |

Switch'lerin durumu `/data/state.json`'da saklanır. Add-on yeniden başlasa da değerleri korunur.

## Örnek otomasyonlar

**Akşam ezanından 10 dk önce bildirim (iftar hatırlatıcısı):**

```yaml
alias: İftara 10 dakika
triggers:
  - trigger: time
    at:
      entity_id: sensor.ezan_aksam
      offset: "-00:10:00"
actions:
  - action: notify.mobile_app_telefonum
    data:
      title: İftar yaklaşıyor
      message: "Akşam ezanı {{ as_timestamp(states('sensor.ezan_aksam')) | timestamp_custom('%H:%M') }}"
```

**Evde kimse yokken ezanı sustur:**

```yaml
alias: Ev boşken ezan sustur
triggers:
  - trigger: state
    entity_id: zone.home
actions:
  - action: "switch.turn_{{ 'on' if states('zone.home') | int(0) == 0 else 'off' }}"
    target:
      entity_id: switch.ezan_sustur
```

**Sabah ezanında koridor ışığını kısık aç:**

```yaml
alias: Sabah ezanı ışık
triggers:
  - trigger: time
    at: sensor.ezan_sabah
conditions:
  - condition: state
    entity_id: switch.ezan_sustur
    state: "off"
actions:
  - action: light.turn_on
    target:
      entity_id: light.koridor
    data:
      brightness_pct: 20
```

## Nasıl çalışır

| Konu | Davranış |
|---|---|
| Vakit kaynağı | 1) Diyanet konum sayfası (HTML tablo) → 2) Diyanet yıllık Excel → 3) `prayertimes.api.abdus.dev`. Yeni veri önbellekle birleştirilir, asla üzerine yazılıp kaybolmaz. |
| Yenileme | Açılışta (o gün çekilmediyse) ve her gün 03:00. Başarısız olursa 30 dk'da bir tekrar dener; bu sırada önbellek kullanılır. |
| Zamanlama | Her gün 00:01'de o günün ezanları kurulur. Saat dilimi `timezone` ayarından gelir, container'ın saat diliminden bağımsızdır. |
| Yeniden başlatma | Geçmiş vakitler kurulmaz. Ayrıca çalmaya başlayan her ezan `/data/state.json`'a yazılır. Aynı dakika içinde yeniden başlasa bile ezan tekrar çalmaz. |
| Watchdog | `http://[HOST]:8099/health`. Bugünün zamanlaması kurulmamışsa 503 döner ve Supervisor add-on'u yeniden başlatır. |

## Sorun giderme

| Log mesajı | Çözüm |
|---|---|
| `Ses dosyası bulunamadı: /media/ezan/adhan.mp3` | Dosyayı `/media/ezan/`'a kopyalayın, adı `audio_file` ile aynı olsun. |
| `media_player_entity geçersiz` | Yapılandırmaya `media_player.xxx` girin. |
| `… 25 sn içinde çalmaya başlamadı` | Hoparlör kapalı/uykuda olabilir. Home Assistant'ın yerel URL'sini kontrol edin (yukarıdaki not). |
| `Hiçbir kaynaktan vakit alınamadı` | İnternet/Diyanet erişimi yok. Önbellek varsa ezanlar çalışmaya devam eder. |
| `MQTT broker bilgisi alınamadı` | Mosquitto add-on'u kurulu ve çalışıyor olmalı. |

## Geliştirme

```bash
cd ezan
npm install
npm test                 # birim + MQTT (gömülü broker) + media_player (sahte HA) testleri
```

Yerelde çalıştırmak için ortam değişkenleri: `EZAN_DATA_DIR`, `EZAN_MEDIA_DIR`, `EZAN_MQTT_URL`, `EZAN_HA_URL` + `EZAN_HA_TOKEN`, `EZAN_HEALTH_PORT`.

GitHub Actions (`.github/workflows/addon.yml`) her push'ta testleri çalıştırır. Ayrıca imajı QEMU ile **aarch64** ve **amd64** için `docker buildx` ile derler,
imaj içinde smoke test yapar (Node, saat dilimi verisi, mpg123/paplay) ve add-on'u s6 + bashio ile başlatıp `/health`'i kontrol eder.

Yerelde Docker varsa:

```bash
docker buildx build --platform linux/arm64 --build-arg BUILD_ARCH=aarch64 -t ezan-addon:aarch64 --load ezan
```

## Lisans

MIT
