# Changelog

## 2.0.0

İlk Home Assistant add-on sürümü (önceki sürüm: Raspberry Pi üzerinde systemd servisi).

### Eklendi
- Home Assistant add-on paketi (`config.yaml`, Dockerfile, çeviriler, watchdog).
- Çıkış modları: `media_player` (HA medya oynatıcısı, `media-source`) ve `local` (PulseAudio).
- MQTT discovery: vakit sensörleri (timestamp), `sensor.ezan_sonraki_vakit`, `sensor.ezan_sonraki_ezan`,
  `sensor.ezan_son_calan`, `switch.ezan_sustur` + vakit bazında susturma, `button.ezan_test`, `button.ezan_durdur`.
- İmsak ezanı (sabah ezanından ayrı, varsayılan kapalı).
- Ezan sonrası hoparlörün önceki ses seviyesini geri yükleme.
- Diyanet konum sayfasından vakit okuma (Excel endpoint'i artık HTML döndürüyor, abdus.dev API'si hata veriyor).
- Günlük vakit yenileme (03:00) ve önbellekle birleştirme.

### Düzeltildi
- Yılbaşı: vakitler her çekişte üzerine yazılıyordu ve "gelecek yıl" ön-çekimi aslında içinde bulunulan yılı çekiyordu.
  Bu yüzden 1 Ocak'ta veri kalmıyordu. Artık veriler birleştiriliyor, 30 günlük tablo da yılı aşıyor.
- O güne ait veri yoksa dünkü zamanlamalar silinmiyor ve ezan dünkü saatlerle çalmaya devam ediyordu.
- "Bugün" süreç saat dilimine göre seçiliyordu. Artık ayarlanan saat dilimi kullanılıyor.
- Yeniden başlatmada aynı ezan tekrar çalabiliyordu. Çalan ezanlar artık `/data/state.json`'a kaydediliyor.
- Susturma durumu yeniden başlatmada kayboluyordu. Artık kalıcı.

### Kaldırıldı
- Web dashboard, HTTPS/PWA ve REST API. Ayarlar artık HA arayüzünden yapılıyor, durum entity'lerden izleniyor.
- castv2 ile doğrudan Google Cast bağlantısı. Yerine `media_player` modu geldi.
- Ramazan iftar/sahur uyarıları. Aynı iş `sensor.ezan_aksam` ve `sensor.ezan_imsak` ile HA otomasyonu olarak yapılabilir.
