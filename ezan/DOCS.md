# Ezan Vakitleri

Diyanet namaz vakitlerinde ezanı bir `media_player`'a veya Raspberry Pi'nin ses çıkışına çalar.
Vakitleri MQTT ile sensör olarak açar.

## İlk kurulum

1. **Mosquitto broker** add-on'u kurulu ve çalışıyor olmalı, **MQTT** entegrasyonu da eklenmiş olmalı.
2. Ezan dosyalarınızı **`/media/ezan/`** klasörüne koyun. Samba'da `media` paylaşımını ya da **Medya → Yerel Medya → Yükle**'yi kullanabilirsiniz.
   Add-on bu klasörü ilk açılışta oluşturur ve içine test için `beep.wav` koyar.
3. Yapılandırmada `media_player_entity` değerini girin (ör. `media_player.mutfak_nest_hub`).
   Pi'nin kendi hoparlöründen çalmak istiyorsanız bunun yerine `output_mode: local` seçin.
4. Add-on'u başlatın ve **Watchdog**'u açık bırakın.
5. Kurulumu `button.ezan_test` ile test edin. Seçili çıkışta %30 seviyesinde bir bip sesi çalmalı.

## Ayarlar

| Ayar | Açıklama |
|---|---|
| `location_id` | Diyanet konum kimliği. Viyana = `11618`. Kendi şehriniz için [namazvakitleri.diyanet.gov.tr](https://namazvakitleri.diyanet.gov.tr)'de şehri seçin; adresteki sayıyı alın. |
| `timezone` | Varsayılan `Europe/Vienna` |
| `output_mode` | `media_player` veya `local` |
| `media_player_entity` | `media_player` modunda ezanın çalınacağı entity |
| `volume` | 0.0 – 1.0 |
| `audio_file` | `/media/ezan/` içindeki ezan dosyası |
| `imsak`, `sabah`, `ogle`, `ikindi`, `aksam`, `yatsi` | Vakit bazında ezan açık/kapalı. İmsak varsayılan olarak kapalı. |
| `fajr_offset` | Sabah ezanı güneş doğuşundan kaç dk önce okunur (varsayılan 40). `0` = imsak saatinde. |
| `fajr_audio_file`, `fajr_volume` | İmsak ve sabah için ayrı dosya ve ses seviyesi (isteğe bağlı) |
| `friday_audio_file`, `friday_volume` | Cuma öğle ezanı için (isteğe bağlı) |
| `dua_audio_file`, `dua_volume` | Her ezandan sonra çalınacak dua (isteğe bağlı) |

`media_player` modunda dosya `media-source://media_source/local/ezan/...` olarak gönderilir; adresi Home Assistant kendisi çözer.
Hoparlörün, Home Assistant'ın **yerel ağ URL'sine** erişebilmesi gerekir (Ayarlar → Sistem → Ağ).
Ezan bitince hoparlörün önceki ses seviyesi geri yüklenir.

## Entity'ler

- **Vakit sensörleri (timestamp):** `sensor.ezan_imsak`, `sensor.ezan_gunes`, `sensor.ezan_ogle`, `sensor.ezan_ikindi`,
  `sensor.ezan_aksam`, `sensor.ezan_yatsi` ve `sensor.ezan_sabah` (sabah ezanının okunacağı saat).
- **`sensor.ezan_sonraki_vakit`:** Sıradaki Diyanet vakti. Öznitelikleri `vakit`, `saat`, `tarih`.
- **`sensor.ezan_sonraki_ezan`:** Gerçekten çalacak bir sonraki ezan.
- **`sensor.ezan_son_calan`:** Son ezan ve durumu. Durum `çalındı`, `atlandı`, `hata` veya `durduruldu` olabilir.
- **`switch.ezan_sustur`:** Açıkken hiçbir ezan çalmaz.
- **Vakit bazında susturma:** `switch.ezan_sustur_imsak`, `_sabah`, `_ogle`, `_ikindi`, `_aksam`, `_yatsi`.
- **Butonlar:** `button.ezan_test` (hoparlör testi), `button.ezan_durdur` (çalan ezanı durdurur).

## Örnek otomasyon

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
      message: "Akşam ezanına 10 dakika var"
```

## Davranış

- Vakitler açılışta ve her gün 03:00'te Diyanet'ten çekilir, `/data`'da önbelleğe alınır.
  Çekilemezse önbellekteki vakitlerle devam edilir ve 30 dakikada bir tekrar denenir.
- Add-on yeniden başlarsa o günün kalan ezanları kurulur. Geçmiş ya da daha önce çalmaya başlamış bir ezan tekrar çalmaz.
- Çalma başarısız olursa 5 saniye arayla 3 kez denenir. Sonuç logda ve `sensor.ezan_son_calan`'da görünür.
